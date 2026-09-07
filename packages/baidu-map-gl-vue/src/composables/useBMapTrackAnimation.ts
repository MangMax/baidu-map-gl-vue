import { onScopeDispose, shallowRef, toRaw, type ShallowRef } from "vue";
import { resolveMapContext } from "./resolveMapContext";
import { ResourceScope } from "../core/lifecycle/ResourceScope";

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
  let plugin: any = null;
  let path: { lng: number; lat: number }[] = [];

  async function createInstance() {
    if (plugin) return plugin;
    const ready = await ctx.whenReady(scope.signal);
    if (scope.isDisposed) return null;
    const api = ready.api as {
      Point: new (lng: number, lat: number) => unknown;
      Polyline: new (path: unknown[], options?: Record<string, unknown>) => unknown;
      TrackAnimation?: new (map: unknown, line: unknown, opts?: unknown) => unknown;
    };
    const registry = ctx.plugins as {
      getStatus?: (name: string) => string | undefined;
      whenPlugin?: (name: string, signal?: AbortSignal) => Promise<unknown>;
    } | null;
    const globalTrackAnimation = (globalThis as any).BMapGLLib?.TrackAnimation;
    if (!registry?.getStatus?.("TrackAnimation") && !api.TrackAnimation && !globalTrackAnimation) {
      throw new Error("TrackAnimation plugin is not ready. Add plugins=['TrackAnimation'] to BMap.");
    }
    const TrackAnimation =
      api.TrackAnimation ??
      globalTrackAnimation ??
      (registry?.whenPlugin ? await registry.whenPlugin("TrackAnimation", scope.signal) : undefined);
    if (typeof TrackAnimation !== "function") {
      throw new Error("TrackAnimation plugin did not expose a constructor.");
    }
    if (path.length < 2) throw new Error("TrackAnimation requires at least two path points.");
    const points = path.map((point) => new api.Point(point.lng, point.lat));
    const polyline = new api.Polyline(points, {
      strokeColor: "#1677ff",
      strokeWeight: 5,
      strokeOpacity: 0.9,
    });
    const mapComponent = (map as { value?: { getMapInstance?: () => unknown } } | undefined)?.value;
    const animationMap = toRaw(mapComponent?.getMapInstance?.() ?? ready.map) as any;
    plugin = new (TrackAnimation as new (map: unknown, line: unknown, opts: unknown) => unknown)(
      animationMap,
      polyline,
      options,
    );
    return plugin;
  }

  async function setPath(nextPath: { lng: number; lat: number }[]) {
    plugin?.cancel?.();
    plugin = null;
    path = nextPath;
    await createInstance();
  }

  async function start() {
    const animation = await createInstance();
    if (!animation) return;
    animation.start();
    status.value = "playing";
  }

  function pause() {
    plugin?.pause?.();
    status.value = "paused";
  }

  function resume() {
    plugin?.continue?.();
    status.value = "playing";
  }

  function stop() {
    status.value = "idle";
    plugin?.cancel?.();
  }

  function cancel() {
    plugin?.cancel?.();
    plugin = null;
    status.value = "idle";
  }

  onScopeDispose(() => {
    plugin?.cancel?.();
    plugin = null;
    status.value = "disposed";
    scope.dispose();
  });

  return { status, setPath, start, pause, resume, stop, proceed: resume, cancel };
}
