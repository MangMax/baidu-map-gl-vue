/**
 * 进程级 SDK Registry
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

const PROCESS_SDK_REGISTRY_SYMBOL = Symbol.for("baidu-map-gl-vue.sdk-registry");

type GlobalWithRegistry = typeof globalThis & {
  [PROCESS_SDK_REGISTRY_SYMBOL]?: Map<string, SdkRegistry>;
};

/**
 * 进程级（同 realm）共享 registry，按 namespace 隔离不同 loader 语义
 * （如 baidu-cdn vs custom-script），同 namespace 内共享 entries。
 * SSR 不执行真实加载，由 load() 内守卫；可变状态不跨请求共享含用户 AK 的服务端状态。
 */
export function getProcessSdkRegistry(
  namespace: string,
  loader: SdkLoader,
  fingerprintFn: (o: BMapLoadOptions) => string,
): SdkRegistry {
  const globalObject = globalThis as GlobalWithRegistry;
  let byNamespace = globalObject[PROCESS_SDK_REGISTRY_SYMBOL];
  if (!byNamespace) {
    byNamespace = new Map<string, SdkRegistry>();
    globalObject[PROCESS_SDK_REGISTRY_SYMBOL] = byNamespace;
  }
  const existing = byNamespace.get(namespace);
  if (existing) return existing;
  const created = new SdkRegistry(loader, fingerprintFn);
  byNamespace.set(namespace, created);
  return created;
}

/** 仅测试使用：重置进程级 registry */
export function resetProcessSdkRegistryForTests(): void {
  delete (globalThis as GlobalWithRegistry)[PROCESS_SDK_REGISTRY_SYMBOL];
}

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
