import { onScopeDispose, shallowRef, toRaw, type ShallowRef } from "vue";
import { resolveMapContext } from "./resolveMapContext";
import { ResourceScope } from "../core/lifecycle/ResourceScope";
import type { ServiceHandle } from "../driver/types/handles";

export interface UseTrackAnimationOptions {
  duration?: number;
  delay?: number;
  overallView?: boolean;
  tilt?: number;
  zoom?: number;
}

export interface TrackAnimationHandle {
  status: ShallowRef<"idle" | "playing" | "paused" | "stopped" | "disposed">;
  setPath(path: { lng: number; lat: number }[]): Promise<void>;
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  proceed: () => void;
  cancel: () => void;
}

/** Thin wrapper around the official BMapGLLib.TrackAnimation plugin. */
export function useBMapTrackAnimation(
  optionsOrMap: UseTrackAnimationOptions | unknown = {},
  mapOrOptions?: unknown,
): TrackAnimationHandle {
  const isMapRef = optionsOrMap && typeof optionsOrMap === "object" && "value" in (optionsOrMap as any);
  const map = (isMapRef ? optionsOrMap : mapOrOptions) as unknown;
  const options = (isMapRef ? mapOrOptions : optionsOrMap) as UseTrackAnimationOptions;
  const ctx = resolveMapContext(map);
  const scope = new ResourceScope();
  const status = shallowRef<TrackAnimationHandle["status"]["value"]>("idle");
  let plugin: ServiceHandle<"service:track-animation"> | null = null;
  let path: { lng: number; lat: number }[] = [];

  async function createInstance() {
    if (plugin) return plugin;
    const ready = await ctx.whenReady(scope.signal);
    if (scope.isDisposed) return null;
    if (path.length < 2) throw new Error("TrackAnimation requires at least two path points.");
    // 插件在后台加载：先等待就绪，避免 ready 当即调用 setPath/start 时构造器缺失
    const registry = ctx.plugins as {
      whenPlugin?: (name: string, signal?: AbortSignal) => Promise<unknown>;
    } | null;
    try {
      await registry?.whenPlugin?.("TrackAnimation", scope.signal);
    } catch {
      /* 未注册或加载失败时由 createTrackAnimation 抛明确错误 */
    }
    if (scope.isDisposed) return null;
    const mapComponent = (map as { value?: { getMapInstance?: () => unknown } } | undefined)?.value;
    const animationMap = (toRaw(mapComponent?.getMapInstance?.() ?? ready.map) as any) ?? ready.map;
    plugin = ready.client.driver.services.createTrackAnimation(
      animationMap,
      path,
      options as Record<string, unknown>,
    );
    return plugin;
  }

  async function setPath(nextPath: { lng: number; lat: number }[]) {
    (plugin?.raw as { cancel?: () => void } | null)?.cancel?.();
    plugin = null;
    path = nextPath;
    await createInstance();
  }

  async function start() {
    const animation = await createInstance();
    if (!animation) return;
    (animation.raw as { start?: () => void }).start?.();
    status.value = "playing";
  }

  function pause() {
    (plugin?.raw as { pause?: () => void } | null)?.pause?.();
    status.value = "paused";
  }

  function resume() {
    (plugin?.raw as { continue?: () => void } | null)?.continue?.();
    status.value = "playing";
  }

  function stop() {
    status.value = "idle";
    (plugin?.raw as { cancel?: () => void } | null)?.cancel?.();
  }

  function cancel() {
    (plugin?.raw as { cancel?: () => void } | null)?.cancel?.();
    plugin = null;
    status.value = "idle";
  }

  onScopeDispose(() => {
    (plugin?.raw as { cancel?: () => void } | null)?.cancel?.();
    plugin = null;
    status.value = "disposed";
    scope.dispose();
  });

  return { status, setPath, start, pause, resume, stop, proceed: resume, cancel };
}
