/**
 * ScriptLoader
 *
 * 进程级 script 加载器,支持:
 * - timeout / abort
 * - CSP nonce、SRI integrity、crossOrigin、referrerPolicy
 * - JSONP callback 唯一性与清理
 * - 失败后从缓存移除,允许重试
 * - SSR 安全(不执行加载)
 *
 * Promise 创建后立即缓存，同 key 并发只创建一个 script。
 * 全路径释放，无残留 callback / listener / 超时 script。
 */
import { BMapError } from "../errors/BMapError";

export interface ScriptLoaderOptions {
  src: string;
  /** 全局 callback 名(JSONP),为空则用 onload */
  callbackName?: string;
  /** callback 挂载到 window 的 target(默认为 callbackName) */
  addCalToWindow?: boolean;
  exportGetter?: () => unknown;
  timeout?: number;
  nonce?: string;
  integrity?: string;
  crossOrigin?: "anonymous" | "use-credentials";
  referrerPolicy?: ReferrerPolicy;
  /** 成功后是否保留 script 元素。百度主 SDK 默认保留，失败 script 一律移除。 */
  retention?: "keep" | "remove-after-load";
}

export interface ScriptRequestFingerprint {
  src: string;
  mode: "load" | "jsonp";
  callbackParam?: string;
  integrity?: string;
  crossOrigin?: string;
}

const isClient = typeof window !== "undefined";

/** 逻辑缓存 key：随机 callback 不参与 key，只区分 src/模式/完整性策略 */
export function getScriptKey(input: {
  src: string;
  callbackName?: string;
  addCalToWindow?: boolean;
  integrity?: string;
  crossOrigin?: string;
}): string {
  let src = input.src;
  try {
    const url = new URL(src, typeof document !== "undefined" ? document.baseURI : "http://localhost/");
    // Provider 将随机 callback 写入 URL；它是本次 script 的实现细节，不得破坏去重。
    url.searchParams.delete(input.addCalToWindow === false ? "__unused_callback__" : "callback");
    src = url.toString();
  } catch {
    // 保留原 src，让非法 URL 继续由浏览器/加载流程报告错误。
  }
  return JSON.stringify({
    src,
    mode: input.addCalToWindow === false ? "load" : "jsonp",
    callbackParam: input.addCalToWindow === false ? undefined : "__bmap_callback__",
    integrity: input.integrity,
    crossOrigin: input.crossOrigin,
  } satisfies ScriptRequestFingerprint);
}

export class ScriptLoader {
  private readonly cache = new Map<string, Promise<Record<string, unknown>>>();

  load(options: ScriptLoaderOptions, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (!isClient) {
      return Promise.reject(
        new BMapError("BMAP_SDK_LOAD_FAILED", "SDK load requires a browser environment"),
      );
    }
    if (signal?.aborted) {
      return Promise.reject(
        new BMapError("BMAP_PROVIDER_ABORTED", "SDK load aborted before start"),
      );
    }
    const key = getScriptKey(options);
    const existing = this.cache.get(key);
    if (existing) return existing;

    // 先占位缓存，再执行真实加载，保证并发只创建一个 script
    let resolveEntry!: (v: Record<string, unknown>) => void;
    let rejectEntry!: (e: unknown) => void;
    const pending = new Promise<Record<string, unknown>>((resolve, reject) => {
      resolveEntry = resolve;
      rejectEntry = reject;
    });
    // 占位期间失败允许重试
    pending.catch(() => {
      if (this.cache.get(key) === pending) {
        this.cache.delete(key);
      }
    });
    this.cache.set(key, pending);

    const script = document.createElement("script");
    script.src = options.src;
    script.type = "text/javascript";
    script.async = true;
    if (options.integrity) script.integrity = options.integrity;
    if (options.crossOrigin) script.crossOrigin = options.crossOrigin;
    if (options.referrerPolicy) script.referrerPolicy = options.referrerPolicy;
    if (options.nonce) script.nonce = options.nonce;

    // 随机 callback 只是本次 script 元素的内部实现，不参与逻辑缓存 key
    const callbackName =
      options.callbackName ?? `__bmap_cb_${Math.random().toString(36).slice(2, 10)}`;
    const useJsonp = options.addCalToWindow !== false;
    const retention = options.retention ?? "keep";
    let settled = false;
    let resolvedSuccessfully = false;
    let timeoutId: number | undefined;

    const cleanup = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      signal?.removeEventListener("abort", onAbort);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      if (!resolvedSuccessfully) {
        // 失败/超时/abort 的 script 一律移除，避免残留执行
        script.remove();
      } else if (retention === "remove-after-load") {
        script.remove();
      }
      if ((window as any)[callbackName]) {
        delete (window as any)[callbackName];
      }
    };

    const fail = (err: BMapError) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (this.cache.get(key) === pending) {
        this.cache.delete(key);
      }
      rejectEntry(err);
    };

    const succeed = (result: unknown) => {
      if (settled) return;
      settled = true;
      resolvedSuccessfully = true;
      cleanup();
      const entry = { [callbackName]: result };
      // 成功后用已决 Promise 替换占位，保持后续调用复用
      this.cache.set(key, Promise.resolve(entry));
      resolveEntry(entry);
    };

    const onLoad = () => succeed(options.exportGetter?.());
    const onError = () => {
      fail(new BMapError("BMAP_SDK_LOAD_FAILED", `Failed to load script: ${options.src}`));
    };
    const onAbort = () => {
      fail(new BMapError("BMAP_PROVIDER_ABORTED", "SDK load aborted"));
    };
    const onTimeout = () => {
      fail(
        new BMapError(
          "BMAP_SDK_LOAD_TIMEOUT",
          `SDK load timed out after ${options.timeout}ms`,
        ),
      );
    };

    if (options.timeout) {
      timeoutId = window.setTimeout(onTimeout, options.timeout);
    }

    if (useJsonp) {
      (window as any)[callbackName] = () => {
        succeed(options.exportGetter?.());
      };
    } else {
      script.addEventListener("load", onLoad);
    }
    script.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });

    document.body.appendChild(script);
    return pending;
  }

  clear(key: string) {
    this.cache.delete(key);
  }

  get size(): number {
    return this.cache.size;
  }
}
