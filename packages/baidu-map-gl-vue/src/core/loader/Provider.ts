/**
 * M2-07: BMapProvider
 *
 * Provider 是唯一允许处理 `window.BMapGL` 的边界(方案 §3.3)。
 * 内置实现:
 * - BaiduCdnProvider:在线 CDN 加载
 * - ExistingGlobalProvider:使用已存在的全局 BMapGL
 * - CustomScriptProvider:离线/私有 apiUrl 或自定义 script
 */
import { BMapError } from "../errors/BMapError";
import { createBaiduSdkUrl, appendCallback, fingerprintConfig, type BMapLoadOptions } from "./url";
import { ScriptLoader } from "./ScriptLoader";
import { SdkRegistry, getProcessSdkRegistry, type SdkLoader } from "./SdkRegistry";

export interface BMapProvider {
  readonly id: string;
  getCacheKey(options: BMapLoadOptions): string;
  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<unknown>;
}

const isClient = typeof window !== "undefined";

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
        { ak: options.ak ?? "", version: options.version ?? "1.0" },
        callbackName,
      );
      await this.loader.load(
        {
          src: url.toString(),
          callbackName,
          addCalToWindow: true,
          exportGetter: () => (window as any).BMapGL,
          timeout: options.timeout,
          nonce: options.nonce,
          integrity: options.integrity,
          crossOrigin: options.crossOrigin,
          referrerPolicy: options.referrerPolicy,
        },
        signal,
      );
      const api = (window as any).BMapGL;
      if (!api)
        throw new BMapError("BMAP_SDK_LOAD_FAILED", "BMap SDK did not expose window.BMapGL");
      return api;
    };
    // P0-09: 同 realm 进程级共享 registry（显式注入优先）
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
    if (!isClient || !(window as any).BMapGL) {
      throw new BMapError("BMAP_SDK_LOAD_FAILED", "window.BMapGL is not present");
    }
    return (window as any).BMapGL;
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
      const callbackName = options.apiUrl
        ? `__bmap_offline_${Math.random().toString(36).slice(2, 10)}`
        : undefined;
      const src = options.apiUrl
        ? appendCallback(this.scriptSrc || options.apiUrl, callbackName!)
        : this.scriptSrc;
      await this.loader.load(
        {
          src,
          callbackName,
          addCalToWindow: Boolean(callbackName),
          exportGetter: () => (window as any).BMapGL,
          timeout: options.timeout,
          nonce: options.nonce,
          integrity: options.integrity,
          crossOrigin: options.crossOrigin,
          referrerPolicy: options.referrerPolicy,
        },
        signal,
      );
      const api = (window as any).BMapGL;
      if (!api)
        throw new BMapError("BMAP_SDK_LOAD_FAILED", "Custom SDK did not expose window.BMapGL");
      return api;
    };
    // P0-09: custom-script 按 scriptSrc 命名空间共享，避免与 cdn loader 混用
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
  return new BaiduCdnProvider();
}

export function existingGlobalProvider(): ExistingGlobalProvider {
  return new ExistingGlobalProvider();
}

export function customScriptProvider(scriptSrc: string): CustomScriptProvider {
  return new CustomScriptProvider(scriptSrc);
}
