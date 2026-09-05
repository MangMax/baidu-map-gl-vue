/**
 * M6-07: 轨迹/视角动画状态机(自有状态,不读取插件私有 _status)
 *
 * 方案 §13.4 / §A.4.4:动画状态由库自身维护,不代理私有字段。
 * PauseReason 记录暂停来源,避免用户主动暂停后被 visibility 恢复覆盖。
 */
export type AnimationPhase = "idle" | "playing" | "paused" | "stopped" | "disposed";

export type PauseReason = "user" | "document-hidden" | "offscreen" | "runtime-dispose";

export interface AnimationStateMachine {
  readonly phase: AnimationPhase;
  readonly pauseReasons: Set<PauseReason>;
  readonly reducedMotion: boolean;
  start(reducedMotion?: boolean): void;
  pause(reason: PauseReason): void;
  resume(reason: PauseReason): void;
  stop(): void;
  dispose(): void;
  /** 是否应实际运行动画(被暂停任一来源则不运行) */
  shouldRun(): boolean;
}

export function createAnimationStateMachine(initialReducedMotion = false): AnimationStateMachine {
  let phase: AnimationPhase = "idle";
  const pauseReasons = new Set<PauseReason>();
  let reducedMotion = initialReducedMotion;

  return {
    get phase() {
      return phase;
    },
    get pauseReasons() {
      return pauseReasons;
    },
    get reducedMotion() {
      return reducedMotion;
    },
    start(reduced) {
      reducedMotion = reduced ?? reducedMotion;
      // reduced-motion 关闭动画
      if (reducedMotion) {
        phase = "stopped";
        return;
      }
      pauseReasons.delete("user");
      phase = "playing";
    },
    pause(reason) {
      pauseReasons.add(reason);
      phase = "paused";
    },
    resume(reason) {
      pauseReasons.delete(reason);
      // 仅当没有其他暂停来源时恢复
      if (pauseReasons.size === 0) phase = "playing";
    },
    stop() {
      phase = "stopped";
      pauseReasons.clear();
    },
    dispose() {
      phase = "disposed";
      pauseReasons.clear();
    },
    shouldRun() {
      return phase === "playing" && pauseReasons.size === 0;
    },
  };
}
