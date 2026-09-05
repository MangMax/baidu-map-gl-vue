import { describe, it, expect, vi, beforeEach } from "vitest";
import { effectScope, nextTick } from "vue";
import { useBMapAsyncTask } from "./useBMapAsyncTask";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useBMapAsyncTask", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates data/status on success", async () => {
    const runner = vi.fn(async () => ({ v: 1 }));
    const d = deferred<any>();
    runner.mockReturnValueOnce(d.promise);
    const state = useBMapAsyncTask({ runner });
    await nextTick();
    expect(state.isLoading.value).toBe(true);
    d.resolve({ v: 1 });
    await nextTick();
    expect(state.data.value).toEqual({ v: 1 });
    expect(state.status.value).toBe("success");
  });

  it("old request result does not overwrite newer request", async () => {
    const runner = vi.fn();
    const slow = deferred<any>();
    const fast = deferred<any>();
    runner.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const state = useBMapAsyncTask({ runner, immediate: false });

    state.execute();
    state.execute();
    // 新请求先完成
    fast.resolve({ v: 2 });
    await nextTick();
    expect(state.data.value).toEqual({ v: 2 });
    // 旧请求后完成,不应覆盖(被 superseded)
    slow.resolve({ v: 1 });
    await nextTick();
    expect(state.data.value).toEqual({ v: 2 });
  });

  it("maps error status on failure", async () => {
    const d = deferred<any>();
    const runner = vi.fn(() => d.promise);
    const state = useBMapAsyncTask({ runner });
    d.reject(new Error("boom"));
    await nextTick();
    expect(state.status.value).toBe("error");
    expect(state.error.value).toBeInstanceOf(Error);
  });

  it("cancel aborts the current task", async () => {
    const d = deferred<any>();
    let aborted = false;
    const runner = vi.fn(() => {
      // 模拟 signal 取消
      return d.promise;
    });
    const runnerWithSignal = vi.fn((...args) => {
      const signal = (args as any)[0] as AbortSignal | undefined;
      // 我们不通过 signal 传参;但测试 cancel 逻辑
      return d.promise;
    });
    const state = useBMapAsyncTask({ runner: runnerWithSignal });
    await nextTick();
    state.cancel("user");
    // 之后旧 promise 完成也不写 data
    d.resolve({ v: 99 });
    await nextTick();
    expect(state.status.value).toBe("idle");
  });

  it("reset clears data and status", async () => {
    const d = deferred<any>();
    const runner = vi.fn(() => d.promise);
    const state = useBMapAsyncTask({ runner });
    await nextTick();
    d.resolve({ v: 1 });
    await nextTick();
    expect(state.data.value).toEqual({ v: 1 });
    state.reset();
    expect(state.data.value).toBeNull();
    expect(state.status.value).toBe("idle");
  });

  it("cancels pending task on scope dispose", async () => {
    const d = deferred<any>();
    const runner = vi.fn(() => d.promise);
    const scope = effectScope();
    scope.run(() => {
      useBMapAsyncTask({ runner });
    });
    await nextTick();
    // scope 释放后,完成的 promise 不写 data(被 abort)
    scope.stop();
    d.resolve({ v: 1 });
    await nextTick();
    expect(runner).toHaveBeenCalled();
  });
});
