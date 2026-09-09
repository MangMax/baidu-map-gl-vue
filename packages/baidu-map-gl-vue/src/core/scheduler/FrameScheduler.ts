/**
 * FrameScheduler
 *
 * 通过 key 合并同一帧内的多次任务调度,同 key 每帧只执行最后一次。
 * 用于:
 * - 地图 viewport patch(center/zoom/heading/tilt 合并提交)
 * - mousemove/moving/dragging 事件合帧
 * - 批量 Overlay 更新
 * - InfoWindow redraw、resize
 *
 * 核心语义:
 * - `schedule(key, task)` 同一帧内同 key 只保留最后一次 task。
 * - `cancel(key)` 取消未执行的 key。
 * - `flush()` 立即执行本帧已排队的任务。
 * - `dispose()` 清理全部待执行任务与 RAF。
 */
export interface FrameScheduler {
  schedule(key: PropertyKey, task: () => void): void;
  cancel(key: PropertyKey): void;
  flush(): void;
  dispose(): void;
}

export function createFrameScheduler(
  raf: (cb: FrameRequestCallback) => number = requestAnimationFrame,
): FrameScheduler {
  const pending = new Map<PropertyKey, () => void>();
  let frameId: number | null = null;
  let disposed = false;

  const runFrame = () => {
    frameId = null;
    if (disposed) return;
    const tasks = [...pending.values()];
    pending.clear();
    for (const task of tasks) {
      try {
        task();
      } catch {
        // 单任务错误不阻断本帧其余任务
      }
    }
  };

  return {
    schedule(key, task) {
      if (disposed) return;
      pending.set(key, task);
      if (frameId === null) {
        frameId = raf(runFrame);
      }
    },
    cancel(key) {
      if (pending.delete(key) && pending.size === 0 && frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    },
    flush() {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      runFrame();
    },
    dispose() {
      disposed = true;
      pending.clear();
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    },
  };
}
