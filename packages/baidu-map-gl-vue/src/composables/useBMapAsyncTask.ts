/**
 * useBMapAsyncTask
 *
 * 统一异步服务 composable 状态封装:
 * - 每次 execute 带 request sequence ID,旧请求结果不得覆盖新请求
 * - runner 接收 { signal, requestId }，支持真实取消；
 *   不支持 AbortSignal 的百度 callback API 在 callback 中检查 signal.aborted
 * - 状态: idle / loading / success / error
 * - cancel 不标记 error；reset 清空 data/error
 * - 卸载时取消 pending task；scope dispose 后不回写任何 ref
 */
import { shallowRef, onScopeDispose, type ShallowRef } from "vue";
import { BMapError } from "../core/errors/BMapError";
import { SERVICE_CALL_TIMEOUT_MS } from "../driver/normalize/serviceCall";

/**
 * 百度 callback 风格服务默认超时:SDK 失败时可能永不回掉,超时后转为明确错误。
 *
 * 单一事实源在 Driver 侧的服务调用适配器（`SERVICE_CALL_TIMEOUT_MS`）——composable 与
 * Facet 必须用同一个超时值，否则「谁先超时」会变成两份真相。
 */
export const SERVICE_TIMEOUT_MS = SERVICE_CALL_TIMEOUT_MS;

/**
 * 把 callback 风格的 SDK 调用包装为 Promise,附带超时保护。
 * settle 后清除 timer,避免泄漏;超时错误码为 BMAP_SERVICE_FAILED。
 */
export function withServiceTimeout<T>(
  start: (done: (value: T) => void, fail: (err: unknown) => void) => void,
  ms = SERVICE_TIMEOUT_MS,
  label = "service",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      timer = null;
      reject(new BMapError("BMAP_SERVICE_FAILED", `${label} timed out after ${ms}ms`));
    }, ms);
    // setTimeout 返回值在测试 fake 计时器下也应可清理,此处不 unref 以兼容浏览器
    const done = (value: T) => {
      if (settled) return;
      settled = true;
      clear();
      resolve(value);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clear();
      reject(err);
    };
    try {
      start(done, fail);
    } catch (err) {
      fail(err);
    }
  });
}

export interface AsyncTaskState<Result> {
  data: ShallowRef<Result | null>;
  error: ShallowRef<unknown>;
  status: ShallowRef<"idle" | "loading" | "success" | "error">;
  isLoading: ShallowRef<boolean>;
  execute: (...args: unknown[]) => Promise<Result | null>;
  cancel: (reason?: unknown) => void;
  reset: () => void;
}

/** 传递给 runner 的取消上下文 */
export interface AsyncTaskContext {
  signal: AbortSignal;
  requestId: number;
}

export interface UseBMapAsyncTaskOptions<Result, Args extends unknown[]> {
  /** 执行体:首参接收取消上下文（signal/requestId），以支持真实取消 */
  runner: (context: AsyncTaskContext, ...args: Args) => Promise<Result>;
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
  let disposed = false;

  async function execute(...execArgs: unknown[]): Promise<Result | null> {
    const currentRequestId = ++requestId;
    // 取消旧请求（逻辑 + signal 双通道）
    activeController?.abort("superseded");
    activeController = new AbortController();
    const controller = activeController;
    const signal = controller.signal;

    status.value = "loading";
    isLoading.value = true;
    error.value = null;

    try {
      // AbortController 传给 runner
      const result = await options.runner(
        { signal, requestId: currentRequestId },
        ...(execArgs as Args),
      );
      if (disposed) return null;
      // scope dispose 后 / 新请求已发出 / 已取消：不回写
      if (currentRequestId !== requestId) return null;
      if (signal.aborted) return null;
      data.value = result;
      status.value = "success";
      isLoading.value = false;
      return result;
    } catch (err) {
      if (disposed) return null;
      if (currentRequestId !== requestId) return null;
      if (signal.aborted) {
        // 被取消:不标记为 error
        isLoading.value = false;
        return null;
      }
      error.value = err;
      status.value = "error";
      isLoading.value = false;
      return null;
    } finally {
      if (currentRequestId === requestId && activeController === controller) {
        activeController = null;
        if (!disposed) isLoading.value = false;
      }
    }
  }

  function cancel(reason?: unknown) {
    requestId++;
    activeController?.abort(reason ?? "cancelled");
    activeController = null;
    if (disposed) return;
    status.value = "idle";
    isLoading.value = false;
  }

  function reset() {
    cancel("reset");
    if (disposed) return;
    data.value = null;
    error.value = null;
    status.value = "idle";
  }

  if (options.immediate !== false) {
    execute(...((args ?? []) as unknown[]));
  }

  if (options.cancelOnScopeDispose !== false) {
    onScopeDispose(() => {
      disposed = true;
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
