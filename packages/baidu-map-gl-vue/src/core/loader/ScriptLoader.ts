/**
 * ScriptLoader
 *
 * 进程级 script 加载器（M3A1-01 / issue #16）：
 * - 模式由显式的 `mode: "load" | "jsonp"` 决定，不再隐式推断；
 * - 相同配置并发调用共用一个底层 `<script>`（SharedLoadTask）；
 * - 每个消费者使用独立 `AbortSignal`，取消互不影响；
 * - 失败 / 超时 / 取消后移除缓存，允许重试；
 * - SSR 安全（不执行加载）。
 *
 * 资源释放见 `SharedLoadTask`：全路径清理 callback、abort listener、timer 与 script。
 */
import { BMapError } from "../errors/BMapError";
import { SharedLoadTask } from "./SharedLoadTask";
import type { ScriptLoaderOptions } from "./SharedLoadTask";
import { DEFAULT_CALLBACK_PARAM, resolveBrowserUrl } from "./url";

export type {
  ScriptJsonpModeOptions,
  ScriptLoadModeOptions,
  ScriptLoaderBaseOptions,
  ScriptLoaderMode,
  ScriptLoaderOptions,
  SharedLoadTaskHooks,
  SharedLoadTaskState,
} from "./SharedLoadTask";
export { SharedLoadTask } from "./SharedLoadTask";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * 逻辑缓存 key：随机 callback 名不参与 key，只区分 src / 模式 / 完整性策略。
 *
 * `src` 经 `resolveBrowserUrl` 归一，保证相对路径与绝对路径指向同一配置时去重。
 */
export function getScriptKey(options: ScriptLoaderOptions): string {
  let src = options.src;
  try {
    const url = resolveBrowserUrl(src);
    // 回调名是本次 script 的实现细节，不得破坏同配置去重。
    const callbackParam =
      options.mode === "jsonp" ? (options.callbackParam ?? DEFAULT_CALLBACK_PARAM) : undefined;
    if (callbackParam) url.searchParams.delete(callbackParam);
    url.searchParams.delete(DEFAULT_CALLBACK_PARAM);
    src = url.toString();
  } catch {
    // 保留原 src，让非法 URL 继续由浏览器/加载流程报告错误。
  }
  return JSON.stringify({
    src,
    mode: options.mode,
    integrity: options.integrity,
    crossOrigin: options.crossOrigin,
  });
}

export class ScriptLoader {
  /** 进行中的共享任务（创建即登记，保证并发同配置只创建一个 script）。 */
  private readonly inFlight = new Map<string, SharedLoadTask>();
  /** 成功结果缓存：全局 SDK 只需加载一次。 */
  private readonly completed = new Map<string, unknown>();

  load(options: ScriptLoaderOptions, signal?: AbortSignal): Promise<unknown> {
    if (!isBrowser()) {
      return Promise.reject(
        new BMapError("BMAP_SDK_LOAD_FAILED", "SDK load requires a browser environment"),
      );
    }
    const key = getScriptKey(options);
    if (this.completed.has(key)) {
      return Promise.resolve(this.completed.get(key));
    }
    if (signal?.aborted) {
      return Promise.reject(
        new BMapError("BMAP_PROVIDER_ABORTED", "SDK load aborted before start"),
      );
    }

    let task = this.inFlight.get(key);
    if (!task) {
      task = new SharedLoadTask(options, {
        onSuccess: (result) => {
          if (this.inFlight.get(key) === task) this.inFlight.delete(key);
          this.completed.set(key, result);
        },
        onFailure: () => {
          // 失败缓存移除：不污染下一次加载。
          if (this.inFlight.get(key) === task) this.inFlight.delete(key);
        },
        onCancelled: () => {
          if (this.inFlight.get(key) === task) this.inFlight.delete(key);
        },
      });
      // 先登记 in-flight，再执行真实加载。
      this.inFlight.set(key, task);
    }
    return task.subscribe(signal);
  }

  /** 移除某配置的成功缓存（测试 / 强制重新加载用）。 */
  clear(key: string): void {
    this.completed.delete(key);
    this.inFlight.delete(key);
  }

  get size(): number {
    return this.inFlight.size + this.completed.size;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  get completedCount(): number {
    return this.completed.size;
  }
}
