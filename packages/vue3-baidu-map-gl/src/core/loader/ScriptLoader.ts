/**
 * M2-08: ScriptLoader
 *
 * 进程级 script 加载器,支持:
 * - timeout / abort
 * - CSP nonce、SRI integrity、crossOrigin、referrerPolicy
 * - JSONP callback 唯一性与清理
 * - 失败后从缓存移除,允许重试
 * - SSR 安全(不执行加载)
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
}

const isClient = typeof window !== "undefined";

export class ScriptLoader {
  private readonly cache = new Map<string, Promise<Record<string, unknown>>>();
  private readonly inFlight = new Map<string, number>();

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
    const key = `${options.src}#${options.callbackName ?? ""}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = options.src;
      script.type = "text/javascript";
      script.async = true;
      if (options.integrity) script.integrity = options.integrity;
      if (options.crossOrigin) script.crossOrigin = options.crossOrigin;
      if (options.referrerPolicy) script.referrerPolicy = options.referrerPolicy;
      if (options.nonce) script.nonce = options.nonce;

      // 唯一 callback 名
      const callbackName =
        options.callbackName ?? `__bmap_cb_${Math.random().toString(36).slice(2, 10)}`;
      let settled = false;

      const cleanup = () => {
        script.onload = null;
        script.onerror = null;
        if (options.addCalToWindow !== false && (window as any)[callbackName]) {
          delete (window as any)[callbackName];
        }
        if (this.inFlight.has(key)) {
          clearTimeout(this.inFlight.get(key));
          this.inFlight.delete(key);
        }
      };

      const timeoutId = options.timeout
        ? window.setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            this.cache.delete(key);
            reject(
              new BMapError(
                "BMAP_SDK_LOAD_TIMEOUT",
                `SDK load timed out after ${options.timeout}ms`,
              ),
            );
          }, options.timeout)
        : undefined;

      const resolveOrReject = (result: unknown, err?: BMapError) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) {
          this.cache.delete(key);
          reject(err);
        } else {
          const entry = { [callbackName]: result };
          this.cache.set(key, Promise.resolve(entry));
          resolve(entry);
        }
      };

      if (options.addCalToWindow !== false) {
        (window as any)[callbackName] = () => {
          resolveOrReject(options.exportGetter?.());
        };
      } else {
        script.onload = () => resolveOrReject(options.exportGetter?.());
      }
      script.onerror = () => {
        resolveOrReject(
          undefined,
          new BMapError("BMAP_SDK_LOAD_FAILED", `Failed to load script: ${options.src}`),
        );
      };

      document.body.appendChild(script);
      if (timeoutId) this.inFlight.set(key, timeoutId);

      signal?.addEventListener(
        "abort",
        () => {
          if (settled) return;
          settled = true;
          cleanup();
          this.cache.delete(key);
          reject(new BMapError("BMAP_PROVIDER_ABORTED", "SDK load aborted"));
        },
        { once: true },
      );
    });
  }

  clear(key: string) {
    this.cache.delete(key);
  }
}
