/**
 * M6-11: useBMapAsyncTask
 *
 * 统一异步服务 composable 状态封装(方案 §13.3):
 * - 每次 execute 带 request sequence ID,旧请求结果不得覆盖新请求
 * - 支持 AbortSignal 或逻辑取消
 * - 状态: idle / loading / success / error
 * - 卸载时取消 pending task
 * - 不依赖具体 SDK 服务,定位/地址解析/坐标转换/轨迹动画复用
 */
import { shallowRef, onScopeDispose, type ShallowRef } from "vue";

export interface AsyncTaskState<Result> {
  data: ShallowRef<Result | null>;
  error: ShallowRef<unknown>;
  status: ShallowRef<"idle" | "loading" | "success" | "error">;
  isLoading: ShallowRef<boolean>;
  execute: (...args: unknown[]) => Promise<Result | null>;
  cancel: (reason?: unknown) => void;
  reset: () => void;
}

export interface UseBMapAsyncTaskOptions<Result, Args extends unknown[]> {
  /** 执行体:可 receive signal 以支持取消 */
  runner: (...args: Args) => Promise<Result>;
  /** 是否立即执行 */
  immediate?: boolean;
  /** 是否在卸载时取消 */
  cancelOnScopeDispose?: boolean;
}

export function useBMapAsyncTask<Result, Args extends unknown[]>(
  options: UseBMapAsyncTaskOptions<Result, Args>,
  args?: Args,
): AsyncTaskState<Result> {
  const data = shallowRef<Result | null>(null);
  const error = shallowRef<unknown>(null);
  const status = shallowRef<"idle" | "loading" | "success" | "error">("idle");
  const isLoading = shallowRef(false);

  let requestId = 0;
  let activeController: AbortController | null = null;

  async function execute(...execArgs: unknown[]): Promise<Result | null> {
    const currentRequestId = ++requestId;
    // 取消旧请求
    activeController?.abort("superseded");
    activeController = new AbortController();
    const signal = activeController.signal;

    status.value = "loading";
    isLoading.value = true;
    error.value = null;

    try {
      const result = await options.runner(...(execArgs as Args));
      // 旧请求结果不覆盖新请求
      if (currentRequestId !== requestId) return null;
      data.value = result;
      status.value = "success";
      isLoading.value = false;
      return result;
    } catch (err) {
      if (currentRequestId !== requestId) return null;
      if (signal.aborted) {
        // 被取消:不标记为 error(除非是显式错误)
        isLoading.value = false;
        return null;
      }
      error.value = err;
      status.value = "error";
      isLoading.value = false;
      return null;
    } finally {
      if (currentRequestId === requestId) {
        activeController = null;
        isLoading.value = false;
      }
    }
  }

  function cancel(reason?: unknown) {
    requestId++;
    activeController?.abort(reason ?? "cancelled");
    activeController = null;
    status.value = "idle";
    isLoading.value = false;
  }

  function reset() {
    cancel("reset");
    data.value = null;
    error.value = null;
    status.value = "idle";
  }

  if (options.immediate !== false) {
    execute(...((args ?? []) as unknown[]));
  }

  if (options.cancelOnScopeDispose !== false) {
    onScopeDispose(() => {
      requestId++;
      activeController?.abort("scope-disposed");
      activeController = null;
      isLoading.value = false;
    });
  }

  return {
    data,
    error,
    status,
    isLoading,
    execute: (...a) => execute(...a),
    cancel,
    reset,
  };
}
