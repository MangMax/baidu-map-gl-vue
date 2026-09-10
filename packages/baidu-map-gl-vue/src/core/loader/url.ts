/**
 * SDK URL 构造（在线 / 离线 Provider 共用）
 *
 * 目标 SDK 是百度地图 JSAPI 4.0：入口固定
 * `https://api.map.baidu.com/api?v=4.0&ak=...`，加载完成后使用全局 `BMap`，
 * 不再使用旧 `BMapGL` 的 `type=webgl` 参数。
 *
 * - 所有参数经 URL API 构造，保留 apiUrl 上已有的 query；
 * - 支持相对 apiUrl（基于 `document.baseURI`，SSR 回退 localhost）；
 * - 已存在的 `callback` 参数属于冲突项，用本次回调名覆盖而非追加重复参数。
 */

/** JSAPI 4.0 在线入口（不含查询串）。 */
export const DEFAULT_API_URL = "https://api.map.baidu.com/api";

/** Stable 基线版本；4.0 加载器不需要也不允许 `type` 参数。 */
export const DEFAULT_VERSION = "4.0";

/** JSONP 就绪回调的默认参数名。 */
export const DEFAULT_CALLBACK_PARAM = "callback";

export type CrossOriginValue = "anonymous" | "use-credentials";

export type BMapLoadOptions = {
  ak?: string;
  /** 支持相对路径（基于 `document.baseURI` 解析）与已有 query；缺省用在线 CDN。 */
  apiUrl?: string;
  version?: string;
  language?: string;
  timeout?: number;
  nonce?: string;
  integrity?: string;
  crossOrigin?: CrossOriginValue;
  referrerPolicy?: ReferrerPolicy;
  /** JSONP 就绪回调的参数名，默认 `callback`。 */
  callbackParam?: string;
};

/** SSR 安全 base：浏览器优先 `document.baseURI`，否则回退 localhost。 */
export function resolveBaseUrl(base?: string): string {
  if (base) return base;
  if (typeof document !== "undefined" && document.baseURI) return document.baseURI;
  return "http://localhost/";
}

/** 浏览器相对 URL 解析：基于 `document.baseURI`，SSR 回退 localhost。 */
export function resolveBrowserUrl(input: string, base?: string): URL {
  return new URL(input, resolveBaseUrl(base));
}

export type CreateBaiduSdkUrlOptions = Pick<
  BMapLoadOptions,
  "ak" | "apiUrl" | "version" | "callbackParam"
>;

/**
 * 构造 JSAPI 4.0 入口 URL。
 *
 * @param options `ak` / `apiUrl` / `version` / `callbackParam`
 * @param callbackName 本次 script 的就绪回调名（写入 `callbackParam`）
 * @param base 测试用 base 覆盖；缺省 `document.baseURI`
 */
export function createBaiduSdkUrl(
  options: CreateBaiduSdkUrlOptions,
  callbackName: string,
  base?: string,
): URL {
  const url = resolveBrowserUrl(options.apiUrl ?? DEFAULT_API_URL, base);
  // 旧 webgl-v1 的 `type` 与 4.0 入口互斥：即便 apiUrl 自带也必须剔除。
  if (url.searchParams.get("type") === "webgl") {
    url.searchParams.delete("type");
  }
  // 版本是全局 SDK 语义的一部分，始终以 4.0 基线覆盖。
  url.searchParams.set("v", options.version ?? DEFAULT_VERSION);
  if (options.ak && !url.searchParams.has("ak")) {
    url.searchParams.set("ak", options.ak);
  }
  // 已有 callback 视为冲突：覆盖为本次回调名，保证只有一个取值。
  url.searchParams.set(options.callbackParam ?? DEFAULT_CALLBACK_PARAM, callbackName);
  return url;
}

/** 离线 / 私有 apiUrl 兼容：仅追加 callback 参数（保留既有 query）。 */
export function appendCallback(
  url: string,
  callbackName: string,
  callbackParam: string = DEFAULT_CALLBACK_PARAM,
  base?: string,
): string {
  const u = resolveBrowserUrl(url, base);
  u.searchParams.set(callbackParam, callbackName);
  return u.toString();
}

/** 内部：`callbackParam` 为 `null` 表示本次加载**不管理**任何回调参数。 */
function normalizeApiUrlInternal(apiUrl: string | undefined, callbackParam: string | null): string {
  if (!apiUrl) return DEFAULT_API_URL;
  try {
    const url = resolveBrowserUrl(apiUrl);
    if (callbackParam) url.searchParams.delete(callbackParam);
    return url.toString();
  } catch {
    // 非法 URL 交给加载流程报告错误，fingerprint 保留原始输入。
    return apiUrl;
  }
}

/**
 * 归一化 apiUrl 用于 fingerprint：只剔除**本次真正使用的**回调参数，
 * 避免随机回调名污染去重；自定义 callbackParam 时不得连带删除 `callback`。
 */
export function normalizeApiUrl(apiUrl?: string, callbackParam?: string): string {
  return normalizeApiUrlInternal(apiUrl, callbackParam ?? DEFAULT_CALLBACK_PARAM);
}

/**
 * 指纹用的 apiUrl 归一：在 `normalizeApiUrl` 的基础上，把内嵌的 `ak` 参数值换成哈希。
 *
 * 调用方可能把 AK 直接写在 `apiUrl` 里（企业自托管入口很常见），而归一后的 apiUrl 会
 * 进入 fingerprint，fingerprint 又会进入 load metadata 与冲突日志——原样保留即等于
 * 泄漏。这里用哈希而不是掩码：不同 AK 仍必须产生不同指纹，否则冲突会被漏判。
 *
 * @param managedCallbackParam 由 Loader 管理的回调参数名；`null` 表示本次加载不管理
 *   任何回调参数（script `load` 模式），此时 URL 上的 `callback` 只是普通查询参数，
 *   必须参与身份判定，否则两个租户入口会被错误合并。
 */
export function fingerprintApiUrl(
  apiUrl?: string,
  managedCallbackParam: string | null = DEFAULT_CALLBACK_PARAM,
): string {
  const normalized = normalizeApiUrlInternal(apiUrl, managedCallbackParam);
  try {
    const url = resolveBrowserUrl(normalized);
    const embedded = url.searchParams.get("ak");
    if (embedded) url.searchParams.set("ak", hash(embedded));
    return url.toString();
  } catch {
    // 非法 URL 交给加载流程报告错误，fingerprint 保留归一化后的原始输入。
    return normalized;
  }
}

/**
 * 计算配置 fingerprint，用于 SDK Registry 去重 / 冲突检测。
 *
 * 覆盖影响全局 SDK 语义的所有配置（版本、AK、apiUrl、语言）；AK 仅以哈希出现，
 * 不存原始值。callback / timeout / nonce 等 script 级细节不参与——**除非**该回调
 * 参数不由 Loader 管理（见 `managedCallbackParam`）。
 *
 * @param managedCallbackParam 由 Loader 管理的回调参数名，缺省按 `options.callbackParam`
 *   或 `callback` 推断；传 `null` 表示本次加载不管理回调参数。
 */
export function fingerprintConfig(
  options: BMapLoadOptions,
  managedCallbackParam?: string | null,
): string {
  const managed =
    managedCallbackParam === undefined
      ? (options.callbackParam ?? DEFAULT_CALLBACK_PARAM)
      : managedCallbackParam;
  const parts = [
    `v:${options.version ?? DEFAULT_VERSION}`,
    `ak:${options.ak ? hash(options.ak) : "none"}`,
    `url:${fingerprintApiUrl(options.apiUrl, managed)}`,
  ];
  if (options.language) parts.push(`lang:${options.language}`);
  return parts.join("|");
}

/** 简单字符串哈希(非加密)，只用于 fingerprint 对比，不存储原始值。 */
export function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/**
 * 生成一次性 JSONP 回调名（挂到全局的函数名）。
 *
 * 名字只需要在本次加载的生命周期内唯一，`prefix` 用于排障时区分调用方；
 * 加载结束（成功 / 失败 / 取消）由 SharedLoadTask 负责把该全局名释放干净。
 */
export function createCallbackName(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}
