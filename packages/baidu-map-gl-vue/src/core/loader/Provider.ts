/**
 * BMapProvider
 *
 * Provider 是唯一允许处理全局 SDK 命名空间的边界。
 * 内置实现:
 * - BaiduCdnProvider:在线 CDN 加载（JSAPI 4.0 入口，见 url.ts）
 * - ExistingGlobalProvider:使用已存在的全局 SDK
 * - CustomScriptProvider:离线/私有 apiUrl 或自定义 script
 *
 * NOTE(#17): v4 Provider（`LoadedJsapiV4`、默认全局与 Registry 收口）由 M3A.1 的
 * SDK Registry / Provider issue 完成；此处仅适配本 issue 重构后的 Loader API，
 * 全局读取保持向前兼容（优先 `BMap`，回退迁移期 `BMapGL`）。
 */
import { BMapError } from "../errors/BMapError";
import {
  appendCallback,
  createBaiduSdkUrl,
  fingerprintConfig,
  type BMapLoadOptions,
} from "./url";
import { ScriptLoader, type ScriptLoaderOptions } from "./ScriptLoader";
import { SdkRegistry, getProcessSdkRegistry, type SdkLoader } from "./SdkRegistry";

export interface BMapProvider {
  readonly id: string;
  getCacheKey(options: BMapLoadOptions): string;
  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<unknown>;
}

function isClient(): boolean {
  return typeof window !== "undefined";
}

/** 迁移期全局读取：v4 目标为 `BMap`，旧实现暴露 `BMapGL`。 */
function readGlobalSdk(): unknown {
  const g = window as unknown as { BMap?: unknown; BMapGL?: unknown };
  return g.BMap ?? g.BMapGL;
}

/** 把 `BMapLoadOptions` 上 script 级配置映射到 Loader 选项。 */
function scriptOptions(options: BMapLoadOptions) {
  return {
    timeout: options.timeout,
    nonce: options.nonce,
    integrity: options.integrity,
    crossOrigin: options.crossOrigin,
    referrerPolicy: options.referrerPolicy,
  };
}

export class BaiduCdnProvider implements BMapProvider {
  readonly id = "baidu-cdn";
  private loader: ScriptLoader;
  private registry: SdkRegistry;

  constructor(loader = new ScriptLoader(), registry?: SdkRegistry) {
    this.loader = loader;
    if (registry) {
      this.registry = registry;
      return;
    }
    const sdkLoader: SdkLoader = async (options, signal) => {
      const callbackName = `__bmap_init_${Math.random().toString(36).slice(2, 10)}`;
      const url = createBaiduSdkUrl(
        {
          ak: options.ak ?? "",
          apiUrl: options.apiUrl,
          version: options.version,
          callbackParam: options.callbackParam,
        },
        callbackName,
      );
      const loadOptions: ScriptLoaderOptions = {
        mode: "jsonp",
        src: url.toString(),
        callbackName,
        callbackParam: options.callbackParam,
        exportGetter: readGlobalSdk,
        ...scriptOptions(options),
      };
      await this.loader.load(loadOptions, signal);
      const api = readGlobalSdk();
      if (!api)
        throw new BMapError("BMAP_SDK_LOAD_FAILED", "BMap SDK did not expose global namespace");
      return api;
    };
    // 同 realm 进程级共享 registry（显式注入优先）
    this.registry = getProcessSdkRegistry("baidu-cdn", sdkLoader, fingerprintConfig);
  }

  getCacheKey(options: BMapLoadOptions): string {
    return fingerprintConfig(options);
  }

  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<unknown> {
    return this.registry.load(options, signal);
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
    if (registry) {
      this.registry = registry;
      return;
    }
    const sdkLoader: SdkLoader = async (options, signal) => {
      // 只有离线 apiUrl 场景才走 JSONP；否则以 script load 事件就绪。
      const useJsonp = Boolean(options.apiUrl);
      const callbackName = useJsonp
        ? `__bmap_offline_${Math.random().toString(36).slice(2, 10)}`
        : undefined;
      const src = useJsonp
        ? appendCallback(this.scriptSrc || options.apiUrl!, callbackName!, options.callbackParam)
        : this.scriptSrc;
      const loadOptions: ScriptLoaderOptions = callbackName
        ? {
            mode: "jsonp",
            src,
            callbackName,
            callbackParam: options.callbackParam,
            exportGetter: readGlobalSdk,
            ...scriptOptions(options),
          }
        : { mode: "load", src, exportGetter: readGlobalSdk, ...scriptOptions(options) };
      await this.loader.load(loadOptions, signal);
      const api = readGlobalSdk();
      if (!api)
        throw new BMapError("BMAP_SDK_LOAD_FAILED", "Custom SDK did not expose global namespace");
      return api;
    };
    // custom-script 按 scriptSrc 命名空间共享，避免与 cdn loader 混用
    this.registry = getProcessSdkRegistry(
      `custom-script:${this.scriptSrc}`,
      sdkLoader,
      fingerprintConfig,
    );
  }

  getCacheKey(options: BMapLoadOptions): string {
    return fingerprintConfig({ ...options, apiUrl: this.scriptSrc || options.apiUrl });
  }

  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<unknown> {
    return this.registry.load(options, signal);
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
 */
export function hasExistingGlobalSdk(): boolean {
  if (!isClient()) return false;
  return Boolean(readGlobalSdk());
}

export function customScriptProvider(scriptSrc: string): CustomScriptProvider {
  return new CustomScriptProvider(scriptSrc);
}
