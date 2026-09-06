/**
 * useBMapViewAnimation —— 视角动画(方案 §13.4)
 *
 * 用 SDK BMapGL.ViewAnimation 实现视角关键帧动画(center/zoom/tilt/heading)。
 * - 通过 map context(resolveMapContext)在 ready 后获取 map 实例
 * - 状态机 INITIAL/PLAYING/STOPPING(不读 SDK 私有 _status)
 * - 卸载时取消动画,不残留
 */
import { ref, shallowRef, onUnmounted, type Ref } from "vue";
import { resolveMapContext } from "./resolveMapContext";
import type { MapReadyContext } from "../core/context/types";

/** 视角动画关键帧 */
export interface ViewAnimationKeyFrames {
  center: { lng: number; lat: number };
  zoom?: number;
  tilt?: number;
  heading?: number;
  /** 百分比 0~1 */
  percentage: number;
}

export interface UseBMapViewAnimationOptions {
  /** 延迟 ms,默认 0 */
  delay?: number;
  /** 持续 ms,默认 1000 */
  duration?: number;
  /** 循环次数,数字或 'INFINITE',默认 1 */
  loop?: number | "INFINITE";
  /** 动画播放时禁用拖拽 */
  disableDragging?: boolean;
}

export type ViewAnimationStatus = "INITIAL" | "PLAYING" | "STOPPING";

function toSdkPoint(api: unknown, p: { lng: number; lat: number }): unknown {
  const Point = (api as { Point: new (lng: number, lat: number) => unknown }).Point;
  return new Point(p.lng, p.lat);
}

export function useBMapViewAnimation(
  options: UseBMapViewAnimationOptions = {},
  map?: unknown,
): {
  viewAnimation: Ref<unknown>;
  start: () => void;
  cancel: () => void;
  stop: () => void;
  proceed: () => void;
  status: Ref<ViewAnimationStatus>;
  setKeyFrames: (keyFrames: ViewAnimationKeyFrames[]) => void;
  ready: Promise<MapReadyContext>;
} {
  const ctx = resolveMapContext(map);
  const status = ref<ViewAnimationStatus>("INITIAL");
  const viewAnimation = shallowRef<unknown>(null);
  const ready = ctx.whenReady();

  let sdkAnimation: { addEventListener?: (n: string, c: () => void) => void } | null = null;
  let keyFramesData: ViewAnimationKeyFrames[] = [];

  /** 关键帧转 SDK 实例(center → BMapGL.Point) */
  function setKeyFrames(keyFrames: ViewAnimationKeyFrames[]) {
    keyFramesData = keyFrames;
  }

  function createAnimation(readyCtx: MapReadyContext) {
    const { api, map } = readyCtx;
    const BMapGL = api as {
      ViewAnimation: new (
        kf: unknown[],
        o?: Record<string, unknown>,
      ) => unknown;
      Point: new (lng: number, lat: number) => unknown;
    };
    const frames = keyFramesData.map((kf) => ({
      ...kf,
      center: toSdkPoint(api, kf.center),
    }));
    const anim = new BMapGL.ViewAnimation(frames, {
      duration: options.duration ?? 1000,
      delay: options.delay ?? 0,
      interation: options.loop ?? 1,
    }) as {
      addEventListener: (n: string, c: () => void) => void;
    };
    // 事件监听(状态同步)
    anim.addEventListener("animationstart", () => (status.value = "PLAYING"));
    anim.addEventListener("animationend", () => (status.value = "INITIAL"));
    anim.addEventListener("animationcancel", () => (status.value = "INITIAL"));
    sdkAnimation = anim;
    viewAnimation.value = anim;
    return { anim, mapImpl: map };
  }

  async function start() {
    if (status.value === "PLAYING") return;
    const readyCtx = await ready;
    if (!sdkAnimation) createAnimation(readyCtx);
    const map = readyCtx.map as {
      startViewAnimation: (a: unknown) => void;
    };
    map.startViewAnimation(viewAnimation.value);
    status.value = "PLAYING";
  }

  function stop() {
    if (status.value !== "PLAYING") return;
    (sdkAnimation as unknown as { _pause?: () => void })._pause?.();
    status.value = "STOPPING";
  }

  function proceed() {
    if (status.value !== "STOPPING") return;
    (sdkAnimation as unknown as { _continue?: () => void })._continue?.();
    status.value = "PLAYING";
  }

  function cancel() {
    if (status.value === "INITIAL") return;
    const map = (ctx.map.value ?? {}) as { stopViewAnimation?: () => void };
    map.stopViewAnimation?.();
    status.value = "INITIAL";
  }

  onUnmounted(() => {
    // 资源归零:取消动画
    const map = (ctx.map.value ?? {}) as { stopViewAnimation?: () => void };
    map.stopViewAnimation?.();
    sdkAnimation = null;
    status.value = "INITIAL";
  });

  return { viewAnimation, start, cancel, stop, proceed, status, setKeyFrames, ready };
}
