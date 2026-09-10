/**
 * LoadedJsapiV4 组装
 *
 * 三个 v4 Provider 共用同一套 metadata 构造，保证「engine / version / namespace /
 * load metadata」的形状、脱敏规则与来源标注完全一致，不会随 Provider 漂移。
 */
import { redactAk } from "../../logger";
import { normalizeApiUrl, type BMapLoadOptions } from "../url";
import { JSAPI_V4_DOMAIN } from "./namespace";
import type {
  JsapiV4LoadMetadata,
  JsapiV4LoadMode,
  JsapiV4ProviderId,
  JsapiV4VersionSource,
  LoadedJsapiV4,
} from "./types";

/** 复用页面已有全局时，metadata 中入口 URL 的占位值。 */
export const EXISTING_GLOBAL_URL = "existing-global";

/** 报错与 metadata 中使用的 AK 引用：只保留末四位。 */
export function akRef(ak?: string): string {
  return ak ? `***${ak.slice(-4)}` : "none";
}

/**
 * URL 脱敏：已知 AK 直接替换；AK 过短（不可能是真实 AK）或未知时退回模式匹配，
 * 避免把测试里的短串当作 AK 误伤 URL。
 */
function redactUrl(url: string, ak?: string): string {
  if (!url) return url;
  return redactAk(url, ak && ak.length >= 6 ? ak : null);
}

export interface CreateLoadedJsapiV4Input {
  readonly providerId: JsapiV4ProviderId;
  readonly mode: JsapiV4LoadMode;
  readonly version: string;
  readonly versionSource: JsapiV4VersionSource;
  readonly options: BMapLoadOptions;
  readonly fingerprint: string;
  readonly namespace: unknown;
  /** 本次真正请求的入口 URL；缺省按 `options.apiUrl` 归一。 */
  readonly apiUrl?: string;
  /** 测试注入时钟。 */
  readonly loadedAt?: number;
}

export function createLoadedJsapiV4(input: CreateLoadedJsapiV4Input): LoadedJsapiV4 {
  const { options } = input;
  const source = input.apiUrl ?? options.apiUrl;
  const normalized = source
    ? normalizeApiUrl(source, options.callbackParam)
    : EXISTING_GLOBAL_URL;
  const metadata: JsapiV4LoadMetadata = {
    providerId: input.providerId,
    domain: JSAPI_V4_DOMAIN,
    mode: input.mode,
    versionSource: input.versionSource,
    apiUrl: redactUrl(normalized, options.ak),
    akRef: akRef(options.ak),
    fingerprint: input.fingerprint,
    loadedAt: input.loadedAt ?? Date.now(),
  };
  return {
    engine: "jsapi-v4",
    version: input.version,
    namespace: input.namespace as LoadedJsapiV4["namespace"],
    load: metadata,
  };
}
