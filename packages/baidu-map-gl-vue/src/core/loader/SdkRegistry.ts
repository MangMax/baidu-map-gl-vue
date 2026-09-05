/**
 * M2-09: 进程级 SDK Registry
 *
 * `window.BMapGL` 是全局资源,由 registry 统一管理:
 * - 相同 fingerprint 并发调用共用同一个 Promise。
 * - 加载失败后从 registry 移除,允许下次重试。
 * - 已加载全局 SDK 后,请求不兼容 fingerprint 抛出 BMAP_SDK_CONFIG_CONFLICT。
 * - SSR 环境不执行 load()。
 */
import { BMapError } from "../errors/BMapError";
import type { BMapLoadOptions } from "./url";

export interface SdkRegistryEntry {
  key: string;
  status: "loading" | "ready" | "error";
  promise: Promise<unknown>;
  configFingerprint: string;
  error?: unknown;
}

export interface SdkLoader {
  (options: BMapLoadOptions, signal?: AbortSignal): Promise<unknown>;
}

const isClient = typeof window !== "undefined";

export class SdkRegistry {
  private entries = new Map<string, SdkRegistryEntry>();
  private loader: SdkLoader;

  constructor(
    loader: SdkLoader,
    private readonly fingerprintFn: (o: BMapLoadOptions) => string,
  ) {
    this.loader = loader;
  }

  get global(): unknown {
    return isClient ? (window as any).BMapGL : undefined;
  }

  async load(options: BMapLoadOptions, signal?: AbortSignal): Promise<unknown> {
    if (!isClient) {
      throw new BMapError("BMAP_SDK_LOAD_FAILED", "SDK load requires a browser environment");
    }

    const fingerprint = this.fingerprintFn(options);

    // 已存在全局 SDK:校验兼容性
    if (this.global) {
      if (this.entries.size > 0) {
        const existing = [...this.entries.values()][0];
        if (existing.configFingerprint !== fingerprint) {
          throw new BMapError(
            "BMAP_SDK_CONFIG_CONFLICT",
            `SDK config conflict: requested ${fingerprint}, loaded ${existing.configFingerprint}`,
          );
        }
      }
      return Promise.resolve(this.global);
    }

    // 复用同 fingerprint 的 in-flight Promise
    const key = fingerprint;
    const existing = this.entries.get(key);
    if (existing && existing.status === "loading") {
      return existing.promise;
    }

    if (existing?.status === "ready") {
      return existing.promise;
    }

    const entry: SdkRegistryEntry = {
      key,
      status: "loading",
      configFingerprint: fingerprint,
      promise: this.loader(options, signal).then(
        (api) => {
          entry.status = "ready";
          return api;
        },
        (error) => {
          entry.status = "error";
          entry.error = error;
          // 失败后移除,允许下次重试
          this.entries.delete(key);
          throw error;
        },
      ),
    };
    this.entries.set(key, entry);
    return entry.promise;
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}
