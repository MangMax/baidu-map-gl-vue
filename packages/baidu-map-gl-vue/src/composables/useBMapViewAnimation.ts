/**
 * useBMapViewAnimation —— 视角动画
 *
 * 用 SDK BMapGL.ViewAnimation 实现视角关键帧动画(center/zoom/tilt/heading)。
 * - 通过 map context(resolveMapContext)在 ready 后获取 map 实例
 * - 状态机 INITIAL/PLAYING/STOPPING(不读 SDK 私有 _status)
 * - 卸载时取消动画,不残留
 */
import { ref, shallowRef, onUnmounted, type Ref } from "vue";
import { resolveMapContext } from "./resolveMapContext";
import type { MapReadyContext } from "../core/context/types";
import type { ServiceHandle } from "../driver/types/handles";

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
  const viewAnimation = shallowRef<ServiceHandle<"service:view-animation"> | null>(null);
  let readyPromise: Promise<MapReadyContext> | null = null;
  const getReady = () => (readyPromise ??= ctx.whenReady());

  let sdkAnimation: ServiceHandle<"service:view-animation"> | null = null;
  let keyFramesData: ViewAnimationKeyFrames[] = [];

  /** 关键帧转 SDK 实例(center → BMapGL.Point,由 Driver 完成) */
  function setKeyFrames(keyFrames: ViewAnimationKeyFrames[]) {
    keyFramesData = keyFrames;
  }

  function createAnimation(readyCtx: MapReadyContext) {
    const anim = readyCtx.client.driver.services.createViewAnimation(keyFramesData as never, {
      duration: options.duration ?? 1000,
      delay: options.delay ?? 0,
      interation: options.loop ?? 1,
    });
    // 事件监听(状态同步)
    readyCtx.client.driver.events.on(anim, "animationstart", () => (status.value = "PLAYING"));
    readyCtx.client.driver.events.on(anim, "animationend", () => (status.value = "INITIAL"));
    readyCtx.client.driver.events.on(anim, "animationcancel", () => (status.value = "INITIAL"));
    sdkAnimation = anim;
    viewAnimation.value = anim;
    return { anim, mapImpl: map };
  }

  async function start() {
    if (status.value === "PLAYING") return;
    const readyCtx = await getReady();
    if (!sdkAnimation) createAnimation(readyCtx);
    readyCtx.client.driver.map.startViewAnimation(readyCtx.map, sdkAnimation!);
    status.value = "PLAYING";
  }

  function stop() {
    if (status.value !== "PLAYING") return;
    const raw = sdkAnimation?.raw as { _pause?: () => void } | undefined;
    raw?._pause?.();
    status.value = "STOPPING";
  }

  function proceed() {
    if (status.value !== "STOPPING") return;
    const raw = sdkAnimation?.raw as { _continue?: () => void } | undefined;
    raw?._continue?.();
    status.value = "PLAYING";
  }

  function cancel() {
    if (status.value === "INITIAL") return;
    void getReady().then((readyCtx) => {
      const raw = sdkAnimation?.raw as { _cancel?: (m: unknown) => void } | undefined;
      raw?._cancel?.(readyCtx.map.raw);
      readyCtx.client.driver.map.stopViewAnimation(readyCtx.map);
    });
    status.value = "INITIAL";
  }

  onUnmounted(() => {
    // 资源归零:取消动画
    void getReady().then((readyCtx) => {
      readyCtx.client.driver.map.stopViewAnimation(readyCtx.map);
    });
    sdkAnimation = null;
    status.value = "INITIAL";
  });

  return {
    viewAnimation,
    start,
    cancel,
    stop,
    proceed,
    status,
    setKeyFrames,
    get ready() {
      return getReady();
    },
  };
}
