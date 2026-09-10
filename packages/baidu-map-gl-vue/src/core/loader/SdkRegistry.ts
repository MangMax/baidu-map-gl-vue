/**
 * 进程级 SDK Registry —— 同一 realm 内的全局 SDK 冲突域
 *
 * `BMap` / `BMapGL` 都是**进程级**全局资源，同一 realm 只能存在一份配置。registry 因此
 * 以「冲突域（domain）」为单位共享，而不是让每个 Provider 各持一份缓存：
 *
 * - 同一 domain 内，相同 fingerprint 的并发 / 后续调用复用同一个任务；
 * - 同一 domain 内，域内已就绪的配置与请求配置不一致时进入冲突策略
 *   （默认 `throw`）——全局 SDK 无法真正并存，「忽略冲突」必须显式配置；
 * - 加载只接受**请求级 loader**，registry 不再持有具体加载实现，也不再读取
 *   `window` / `document`，因此 SSR 导入安全、可脱离 DOM 单测；
 * - 失败 / 取消后条目被移除，允许下一次重试，不残留半成品状态。
 *
 * 域划分：所有 JSAPI 4.0 Provider 共用 `BMap` 域（见 `providers/namespace.ts`）；
 * 迁移期 legacy Provider 使用独立的 `BMapGL` 域，由 M3A.3 的默认切换一并删除。
 */
import { BMapError } from "../errors/BMapError";
import { logger } from "../logger";

export interface SdkRegistryEntry {
  status: "loading" | "ready" | "error";
  promise: Promise<unknown>;
  error?: unknown;
}

/**
 * 请求级加载任务：`options` 已由 Provider 闭包捕获，因此同一 domain 可以服务
 * 多个语义不同的 Provider，而共享同一份「已加载配置」冲突判定。
 */
export type SdkLoader<T = unknown> = (signal?: AbortSignal) => Promise<T>;

export interface SdkRegistryLoadRequest<T = unknown> {
  /** 参与复用与冲突判定的配置指纹（AK 必须已脱敏进哈希）。 */
  fingerprint: string;
  /** 真正的加载实现；只在无同指纹 in-flight / 已就绪结果时调用。 */
  loader: SdkLoader<T>;
}

/** 域内已就绪配置与请求配置冲突时的处理策略。 */
export type SdkConflictPolicy = "throw" | "warn" | "ignore";

export interface SdkConflictInfo {
  readonly domain: string;
  /** 本次请求的配置指纹。 */
  readonly requested: string;
  /** 域内已就绪的配置指纹。 */
  readonly active: string;
}

export interface SdkRegistryOptions {
  /** 冲突域名称，用于错误信息与诊断。 */
  readonly domain?: string;
  /** 冲突策略，默认 `throw`。 */
  readonly conflictPolicy?: SdkConflictPolicy;
  /** 冲突观测出口（`warn` / `ignore` 下用于上报）。 */
  readonly onConflict?: (info: SdkConflictInfo) => void;
}

const DEFAULT_CONFLICT_POLICY: SdkConflictPolicy = "throw";
const DEFAULT_DOMAIN = "default";

const PROCESS_SDK_REGISTRY_SYMBOL = Symbol.for("baidu-map-gl-vue.sdk-registry");

type GlobalWithRegistry = typeof globalThis & {
  [PROCESS_SDK_REGISTRY_SYMBOL]?: Map<string, SdkRegistry>;
};

/**
 * 取同一 realm 内某个冲突域共享的 registry。
 *
 * `options` 只在**首次创建**该域时生效；后续调用复用既有实例，避免不同 Provider
 * 用各自的策略互相覆盖。
 */
export function getProcessSdkRegistry(
  domain: string = DEFAULT_DOMAIN,
  options: SdkRegistryOptions = {},
): SdkRegistry {
  const globalObject = globalThis as GlobalWithRegistry;
  let byDomain = globalObject[PROCESS_SDK_REGISTRY_SYMBOL];
  if (!byDomain) {
    byDomain = new Map<string, SdkRegistry>();
    globalObject[PROCESS_SDK_REGISTRY_SYMBOL] = byDomain;
  }
  const existing = byDomain.get(domain);
  if (existing) return existing;
  const created = new SdkRegistry({ domain, ...options });
  byDomain.set(domain, created);
  return created;
}

/** 仅测试使用：重置进程级 registry（所有冲突域）。 */
export function resetProcessSdkRegistryForTests(): void {
  delete (globalThis as GlobalWithRegistry)[PROCESS_SDK_REGISTRY_SYMBOL];
}

export class SdkRegistry {
  private readonly entries = new Map<string, SdkRegistryEntry>();
  /** 域内已就绪的配置指纹；`undefined` 表示本域尚未成功加载过任何配置。 */
  private loadedFingerprint: string | undefined;
  private readonly domain: string;
  private readonly onConflict: ((info: SdkConflictInfo) => void) | undefined;
  private readonly conflictPolicy: SdkConflictPolicy;

  constructor(options: SdkRegistryOptions = {}) {
    this.domain = options.domain ?? DEFAULT_DOMAIN;
    this.conflictPolicy = options.conflictPolicy ?? DEFAULT_CONFLICT_POLICY;
    this.onConflict = options.onConflict;
  }

  get policy(): SdkConflictPolicy {
    return this.conflictPolicy;
  }

  /** 域内已就绪的配置指纹，用于诊断与测试断言。 */
  get activeFingerprint(): string | undefined {
    return this.loadedFingerprint;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * 在域内加载：
   * - 与域内已就绪配置冲突 → 交给冲突策略（默认 reject `BMAP_SDK_CONFIG_CONFLICT`）；
   * - 同指纹已有 in-flight / 已就绪条目 → 复用；
   * - 否则执行请求级 loader，成功后登记为域内已就绪配置。
   */
  load<T>(request: SdkRegistryLoadRequest<T>, signal?: AbortSignal): Promise<T> {
    const fingerprint = request.fingerprint;

    if (this.loadedFingerprint !== undefined && this.loadedFingerprint !== fingerprint) {
      const conflict = this.conflictError(fingerprint);
      // 保持与旧实现一致的「返回 rejected Promise」语义，调用方 `await` 即可捕获；
      // `warn` / `ignore` 策略下无冲突错误，继续走正常加载。
      if (conflict) return Promise.reject(conflict);
    }

    const existing = this.entries.get(fingerprint);
    if (existing && existing.status !== "error") {
      return existing.promise as Promise<T>;
    }

    const entry: SdkRegistryEntry = {
      status: "loading",
      promise: Promise.resolve()
        .then(() => request.loader(signal))
        .then(
          (result) => {
            entry.status = "ready";
            // 先登记「已就绪配置」，再唤醒消费者，避免消费者重入时读到空的 active。
            this.loadedFingerprint ??= fingerprint;
            return result;
          },
          (error) => {
            entry.status = "error";
            entry.error = error;
            // 失败后移除，允许下次重试。
            if (this.entries.get(fingerprint) === entry) this.entries.delete(fingerprint);
            throw error;
          },
        ),
    };
    this.entries.set(fingerprint, entry);
    return entry.promise as Promise<T>;
  }

  /** 移除全部条目（测试 / 强制重新加载用）；不改变域内已就绪配置。 */
  clear(): void {
    this.entries.clear();
  }

  /** 构造冲突错误：策略为 `throw` 时抛出，否则记录观测并返回 `undefined`。 */
  private conflictError(requested: string): Error | undefined {
    const active = this.loadedFingerprint as string;
    const info: SdkConflictInfo = { domain: this.domain, requested, active };
    this.onConflict?.(info);
    const message = `SDK config conflict in ${this.domain}: requested ${requested}, loaded ${active}`;
    if (this.conflictPolicy === "throw") {
      // 指纹内 AK 已哈希，消息不会泄漏完整 AK。
      return new BMapError("BMAP_SDK_CONFIG_CONFLICT", message);
    }
    if (this.conflictPolicy === "warn") logger.warn(message);
    // `ignore`：显式配置后才可能走到这里，保持静默。
    return undefined;
  }
}
