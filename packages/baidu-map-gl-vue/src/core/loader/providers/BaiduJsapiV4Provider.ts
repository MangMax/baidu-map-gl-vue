/**
 * BaiduJsapiV4Provider —— 在线 CDN（JSAPI 4.0）
 *
 * - 入口固定 `v=4.0`，且剔除迁移期 `type=webgl`（见 `../url.ts`）；调用方显式声明
 *   其它 `version` 会被前置校验拒绝，不会静默降级；
 * - 就绪信号是 JSONP `callback`，**不是** script `load` 事件：官方文档明确
 *   「不要仅凭 script 的 load 事件就认为 BMap 已经可用」；
 * - 回调触发后从 `globalThis.BMap` 读取命名空间并校验 `Map` / `Point` / `Marker`；
 * - 与所有 v4 Provider 共享同一进程级 `BMap` 冲突域：相同配置复用同一任务，
 *   不同 AK / 版本按默认 `throw` 策略报结构化冲突。
 */
import { SdkRegistry, getProcessSdkRegistry } from "../SdkRegistry";
import { ScriptLoader, scriptOptions } from "../ScriptLoader";
import type { BMapLoadOptions } from "../url";
import { DEFAULT_VERSION, createBaiduSdkUrl, createCallbackName, fingerprintConfig } from "../url";
import { createLoadedJsapiV4 } from "./loaded";
import {
  JSAPI_V4_DOMAIN,
  assertSupportedJsapiV4Version,
  readJsapiV4Global,
  requireJsapiV4Global,
} from "./namespace";
import { reuseExistingJsapiV4 } from "./reuse";
import type { JsapiV4Provider, JsapiV4ProviderOptions, LoadedJsapiV4 } from "./types";

/** 一次性全局回调名前缀（与 legacy `__bmap_init_` 区分，便于排障）。 */
const CALLBACK_PREFIX = "__bmap_v4_";

export class BaiduJsapiV4Provider implements JsapiV4Provider {
  readonly id = "baidu-jsapi-v4" as const;
  private readonly loader: ScriptLoader;
  private readonly domain: SdkRegistry;

  constructor(options: JsapiV4ProviderOptions = {}) {
    this.loader = options.loader ?? new ScriptLoader();
    this.domain =
      options.registry ?? getProcessSdkRegistry(JSAPI_V4_DOMAIN, { domain: JSAPI_V4_DOMAIN });
  }

  getCacheKey(options: BMapLoadOptions): string {
    return fingerprintConfig(options);
  }

  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedJsapiV4> {
    const fingerprint = fingerprintConfig(options);
    return this.domain.load<LoadedJsapiV4>(
      {
        fingerprint,
        loader: (requestSignal) => this.performLoad(options, fingerprint, requestSignal),
      },
      signal,
    );
  }

  private async performLoad(
    options: BMapLoadOptions,
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<LoadedJsapiV4> {
    assertSupportedJsapiV4Version(options, this.id);

    // 页面已存在 v4 全局：直接校验并复用，不再插入 script。
    const reused = reuseExistingJsapiV4({ providerId: this.id, options, fingerprint });
    if (reused) return reused;

    const callbackName = createCallbackName(CALLBACK_PREFIX);
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
        exportGetter: readJsapiV4Global,
        ...scriptOptions(options),
      },
      signal,
    );

    return createLoadedJsapiV4({
      providerId: this.id,
      mode: "jsonp",
      // 版本由本次入口 URL 的 `v` 参数决定，不依赖全局对象自述。
      version: options.version ?? DEFAULT_VERSION,
      versionSource: "url",
      options,
      fingerprint,
      apiUrl: url.toString(),
      namespace: requireJsapiV4Global(this.id),
    });
  }
}

/** 在线 CDN Provider 工厂（与 legacy `baiduCdnProvider()` 对称；不收 AK，AK 经 loadOptions 传入）。 */
export function baiduJsapiV4Provider(options: JsapiV4ProviderOptions = {}): BaiduJsapiV4Provider {
  return new BaiduJsapiV4Provider(options);
}
