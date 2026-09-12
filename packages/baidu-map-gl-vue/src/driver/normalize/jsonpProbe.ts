/**
 * JSONP 服务错误嗅探（M3A2-SERVICES-NATIVE / issue #23，从 `webgl-v1/services.ts` 抽出）
 *
 * 百度 JSAPI 的服务请求走 JSONP：失败（如配额 302 / Referer 限制）时**只回 `null`**，
 * 并把服务端错误码丢进 `_rd` 回调注册表。本模块把注册表里的错误还原成结构化信息，
 * 供服务适配器把「空结果」与「失败」区分开。
 *
 * 两个引擎共用（webgl-v1 的 `captureJsonpServiceError` 现在是本模块的再导出）：
 * 嗅探逻辑只依赖 `rawSdk._rd` 的形状，与 engine 无关；`_rd` 不存在时静默退化为空捕获，
 * 不影响正常流程——包装器**只记录不阻断**业务回调。
 */
export interface JsonpServiceErrorInfo {
  code: number | string;
  message: string;
}

export interface JsonpErrorCapture {
  /** 扫描并包装新增回调；SDK 调用前后各调一次 */
  rescan(): void;
  getLastError(): JsonpServiceErrorInfo | null;
}

export function captureJsonpServiceError(rawSdk: unknown): JsonpErrorCapture {
  const noop: JsonpErrorCapture = { rescan: () => {}, getLastError: () => null };
  try {
    const ns = (rawSdk as Record<string, unknown> | null | undefined)?.["_rd"] as Record<
      string,
      unknown
    > | null | undefined;
    if (!ns || typeof ns !== "object") return noop;
    const seen = new Set<string>();
    try {
      for (const key of Object.keys(ns)) seen.add(key);
    } catch {
      return noop;
    }
    let last: JsonpServiceErrorInfo | null = null;
    const wrap = () => {
      let keys: string[];
      try {
        keys = Object.keys(ns);
      } catch {
        return;
      }
      for (const key of keys) {
        if (seen.has(key)) continue;
        seen.add(key);
        let fn: unknown;
        try {
          fn = ns[key];
        } catch {
          continue;
        }
        if (typeof fn !== "function") continue;
        const original = fn as (...args: unknown[]) => unknown;
        try {
          ns[key] = function (this: unknown, ...args: unknown[]) {
            try {
              const payload = args[0] as {
                result?: { error?: unknown; error_msg?: unknown };
              } | null | undefined;
              const code = payload?.result?.error;
              const isError =
                (typeof code === "number" && code !== 0) ||
                (typeof code === "string" && code !== "" && code !== "0");
              if (isError) {
                last = {
                  code: code as number | string,
                  message: String(payload?.result?.error_msg ?? ""),
                };
              }
            } catch {
              /* 嗅探失败不影响业务回调 */
            }
            return original.apply(this, args);
          };
        } catch {
          /* 冻结对象等情况直接跳过 */
        }
      }
    };
    return {
      rescan: () => {
        try {
          wrap();
        } catch {
          /* ignore */
        }
      },
      getLastError: () => last,
    };
  } catch {
    return noop;
  }
}
