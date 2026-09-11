/**
 * BMapProvider（迁移期 legacy 实现）
 *
 * Provider 是唯一允许处理全局 SDK 命名空间的边界。这里的三个实现是 **webgl-v1 →
 * JSAPI 4.0 迁移期** 的过渡路径，返回裸全局对象（`Promise<unknown>`），语义保持宽松：
 * - BaiduCdnProvider:在线 CDN 加载（JSAPI 4.0 入口，见 url.ts）
 * - ExistingGlobalProvider:使用已存在的全局 SDK
 * - CustomScriptProvider:离线/私有 apiUrl 或自定义 script
 *
 * 结构化契约在 `./providers`（issue #17）：`BaiduJsapiV4Provider` /
 * `ExistingGlobalV4Provider` / `CustomScriptV4Provider` 返回 `LoadedJsapiV4`，统一
 * 落在进程级 `BMap` 冲突域内；默认 Client / 组件切换在 M3A.1-CLIENT（#18）完成，
 * legacy 实现随 M3A.3（#26）删除。
 *
 * 全局读取保持向前兼容（优先 `BMap`，回退迁移期 `BMapGL`），因此 legacy Provider
 * 使用独立的 `BMapGL` 冲突域：两个域对应两个不同的全局对象，不能在 v4 默认切换
 * 之前混用同一域的复用与冲突判定。
 */
import { BMapError } from "../errors/BMapError";
import {
  appendCallback,
  createBaiduSdkUrl,
  createCallbackName,
  fingerprintConfig,
  type BMapLoadOptions,
} from "./url";
import { ScriptLoader, scriptOptions } from "./ScriptLoader";
import { SdkRegistry, getProcessSdkRegistry } from "./SdkRegistry";

export interface BMapProvider {
  readonly id: string;
  getCacheKey(options: BMapLoadOptions): string;
  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<unknown>;
}

/**
 * 迁移期 legacy Provider 的冲突域；随 M3A.3 默认切换一并删除。
 *
 * 刻意不导出：公共声明不得出现迁移期命名空间字样（见
 * `scripts/check-public-dts.mts` 的 `legacy-namespace` 规则）。
 */
const LEGACY_SDK_DOMAIN = "BMapGL";

function isClient(): boolean {
  return typeof window !== "undefined";
}

/** 迁移期全局读取：v4 目标为 `BMap`，旧实现暴露 `BMapGL`。 */
function readGlobalSdk(): unknown {
  const g = window as unknown as { BMap?: unknown; BMapGL?: unknown };
  return g.BMap ?? g.BMapGL;
}

export class BaiduCdnProvider implements BMapProvider {
  readonly id = "baidu-cdn";
  private loader: ScriptLoader;
  private registry: SdkRegistry;

  constructor(loader = new ScriptLoader(), registry?: SdkRegistry) {
    this.loader = loader;
    this.registry =
      registry ??
      getProcessSdkRegistry(LEGACY_SDK_DOMAIN, { domain: LEGACY_SDK_DOMAIN });
  }

  getCacheKey(options: BMapLoadOptions): string {
    return fingerprintConfig(options);
  }

  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<unknown> {
    return this.registry.load(
      {
        fingerprint: fingerprintConfig(options),
        loader: (requestSignal) => this.performLoad(options, requestSignal),
      },
      signal,
    );
  }

  private async performLoad(
    options: BMapLoadOptions,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const present = isClient() ? readGlobalSdk() : undefined;
    if (present) return present;

    const callbackName = createCallbackName("__bmap_init_");
    const url = createBaiduSdkUrl(
      {
        ak: options.ak ?? "",
        apiUrl: options.apiUrl,
        version: options.version,
        callbackParam: options.callbackParam,
      },
      callbackName,
    );
    await this.loader.load(
      {
        mode: "jsonp",
        src: url.toString(),
        callbackName,
        callbackParam: options.callbackParam,
        exportGetter: readGlobalSdk,
        ...scriptOptions(options),
      },
      signal,
    );
    const api = readGlobalSdk();
    if (!api)
      throw new BMapError("BMAP_SDK_LOAD_FAILED", "BMap SDK did not expose global namespace");
    return api;
  }
}

export class ExistingGlobalProvider implements BMapProvider {
  readonly id = "existing-global";
  getCacheKey() {
    return "existing-global";
  }
  async load(): Promise<unknown> {
    if (!isClient() || !readGlobalSdk()) {
      throw new BMapError("BMAP_SDK_LOAD_FAILED", "global BMap SDK is not present");
    }
    return readGlobalSdk();
  }
}

export class CustomScriptProvider implements BMapProvider {
  readonly id = "custom-script";
  private loader: ScriptLoader;
  private registry: SdkRegistry;

  constructor(
    private readonly scriptSrc: string,
    loader = new ScriptLoader(),
    registry?: SdkRegistry,
  ) {
    this.loader = loader;
    this.registry =
      registry ??
      getProcessSdkRegistry(LEGACY_SDK_DOMAIN, { domain: LEGACY_SDK_DOMAIN });
  }

  getCacheKey(options: BMapLoadOptions): string {
    return fingerprintConfig({ ...options, apiUrl: this.scriptSrc || options.apiUrl });
  }

  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<unknown> {
    return this.registry.load(
      {
        fingerprint: this.getCacheKey(options),
        loader: (requestSignal) => this.performLoad(options, requestSignal),
      },
      signal,
    );
  }

  private async performLoad(
    options: BMapLoadOptions,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const present = isClient() ? readGlobalSdk() : undefined;
    if (present) return present;

    // 只有离线 apiUrl 场景才走 JSONP；否则以 script load 事件就绪。
    const useJsonp = Boolean(options.apiUrl);
    const callbackName = useJsonp ? createCallbackName("__bmap_offline_") : undefined;
    const src = useJsonp
      ? appendCallback(this.scriptSrc || options.apiUrl!, callbackName!, options.callbackParam)
      : this.scriptSrc;
    await this.loader.load(
      callbackName
        ? {
            mode: "jsonp",
            src,
            callbackName,
            callbackParam: options.callbackParam,
            exportGetter: readGlobalSdk,
            ...scriptOptions(options),
          }
        : { mode: "load", src, exportGetter: readGlobalSdk, ...scriptOptions(options) },
      signal,
    );
    const api = readGlobalSdk();
    if (!api)
      throw new BMapError("BMAP_SDK_LOAD_FAILED", "Custom SDK did not expose global namespace");
    return api;
  }
}

export function baiduCdnProvider(options?: Partial<BMapLoadOptions>): BaiduCdnProvider {
  void options;
  return new BaiduCdnProvider();
}

export function existingGlobalProvider(): ExistingGlobalProvider {
  return new ExistingGlobalProvider();
}

/**
 * 全局 SDK 存在性探测（Loader 边界内）。
 * 组件/Composable/Runtime 不得直接读全局命名空间，统一经此判断。
 * v4 结构化路径见 `./providers` 的 `readJsapiV4Global()`。
 */
export function hasExistingGlobalSdk(): boolean {
  if (!isClient()) return false;
  return Boolean(readGlobalSdk());
}

export function customScriptProvider(scriptSrc: string): CustomScriptProvider {
  return new CustomScriptProvider(scriptSrc);
}
