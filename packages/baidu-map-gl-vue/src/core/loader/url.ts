/**
 * M2-08: SDK URL 构造(在线 Provider 的一部分)
 *
 * 使用 URL API 构造参数,不再手工拼 `&callback=`(方案 §8.2)。
 */

export type BMapLoadOptions = {
  ak?: string;
  apiUrl?: string;
  version?: string;
  language?: string;
  timeout?: number;
  nonce?: string;
  integrity?: string;
  crossOrigin?: "anonymous" | "use-credentials";
  referrerPolicy?: ReferrerPolicy;
};

export function createBaiduSdkUrl(
  options: Pick<BMapLoadOptions, "ak" | "version">,
  callbackName: string,
): URL {
  const url = new URL("https://api.map.baidu.com/api");
  url.searchParams.set("type", "webgl");
  url.searchParams.set("v", options.version ?? "1.0");
  url.searchParams.set("ak", options.ak ?? "");
  url.searchParams.set("callback", callbackName);
  return url;
}

/** 离线/私有 apiUrl 兼容:保留 callBack 追加(方案 §8.4 保留简单 apiUrl 兼容层) */
export function appendCallback(url: string, callbackName: string): string {
  const u = new URL(url);
  u.searchParams.set("callback", callbackName);
  return u.toString().replace(/&$/, "");
}

/** 计算配置 fingerprint,用于 SDK Registry 去重/冲突检测 */
export function fingerprintConfig(options: BMapLoadOptions): string {
  const parts: string[] = [];
  if (options.ak) parts.push(`ak:${hash(options.ak)}`);
  if (options.version) parts.push(`v:${options.version}`);
  if (options.language) parts.push(`lang:${options.language}`);
  if (options.apiUrl) parts.push(`url:${options.apiUrl}`);
  return parts.length ? parts.join("|") : "default";
}

/** 简单字符串哈希(非加密),只用于 fingerprint 对比,不存储原始值 */
export function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}
