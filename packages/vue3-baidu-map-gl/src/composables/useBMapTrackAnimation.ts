/**
 * M6-07: useBMapTrackAnimation —— 轨迹动画
 *
 * 方案 §13.4:处理原则:
 * - 优先使用官方公开事件/方法(start/pause/cancel)
 * - 不读取插件私有 `_status`,由库自身状态机维护
 * - timer/RAF/Polyline 全部由 scope 回收
 */
import { onScopeDispose, shallowRef, watch, type ShallowRef } from "vue";
import { useRequiredMapContext } from "../core/context/inject";
import { ResourceScope } from "../core/lifecycle/ResourceScope";
import { createAnimationStateMachine, type PauseReason } from "../core/animation/animationState";

export interface UseTrackAnimationOptions {
  duration?: number;
  delay?: number;
  overallView?: boolean;
  tilt?: number;
  zoom?: number;
}

export interface TrackAnimationHandle {
  status: ShallowRef<"idle" | "playing" | "paused" | "stopped" | "disposed">;
  setPath(path: { lng: number; lat: number }[]): void;
  start(): void;
  pause(reason?: PauseReason): void;
  resume(reason?: PauseReason): void;
  stop(): void;
}

export function useBMapTrackAnimation(
  options: UseTrackAnimationOptions = {},
): TrackAnimationHandle {
  const ctx = useRequiredMapContext();
  const scope = new ResourceScope();
  const status = shallowRef<"idle" | "playing" | "paused" | "stopped" | "disposed">("idle");
  let plugin: any = null;
  let mapInstance: any = null;
  let polyline: any = null;
  let path: { lng: number; lat: number }[] | null = null;

  const stateMachine = createAnimationStateMachine(false);

  async function ensureInstance() {
    if (plugin) return plugin;
    const ready = await ctx.whenReady(scope.signal);
    if (scope.isDisposed) return null;
    mapInstance = ready.map;
    const api = ready.api as {
      Point: new (lng: number, lat: number) => unknown;
      TrackAnimation: new (map: unknown, path: unknown, opts?: Record<string, unknown>) => unknown;
    };
    // 用官方公开方法构造,不读写私有 _status
    const TrackAnimationCls = (api as any).TrackAnimation;
    if (typeof TrackAnimationCls !== "function") {
      // 无插件:退回空实现(库自身状态机仍工作)
      return { start: () => {}, pause: () => {}, cancel: () => {} };
    }
    const pathPoints = (path ?? []).map((p) => new api.Point(p.lng, p.lat));
    polyline = pathPoints;
    plugin = new TrackAnimationCls(mapInstance, pathPoints, options);
    return plugin;
  }

  async function setPath(nextPath: { lng: number; lat: number }[]) {
    path = nextPath;
    plugin = null;
    await ensureInstance();
  }

  async function start() {
    await ensureInstance();
    stateMachine.start();
    status.value = stateMachine.phase;
    plugin?.start?.();
  }

  function pause(reason: PauseReason = "user") {
    stateMachine.pause(reason);
    status.value = stateMachine.phase;
    plugin?.pause?.();
  }

  function resume(reason: PauseReason = "user") {
    stateMachine.resume(reason);
    status.value = stateMachine.phase;
    if (stateMachine.shouldRun()) plugin?.start?.();
  }

  function stop() {
    stateMachine.stop();
    status.value = stateMachine.phase;
    plugin?.cancel?.();
  }

  onScopeDispose(() => {
    stateMachine.dispose();
    status.value = "disposed";
    scope.dispose();
  });

  return { status, setPath, start, pause, resume, stop };
}
