/**
 * MapContext 解析工具:优先 BMap 注入上下文,否则用外部传入的 map 实例
 * 构造轻量上下文(v2 兼容:useXxx(map) 用法)。
 *
 * - 在 BMap 内部调用:hook 自动获得注入的上下文(推荐)。
 * - 在 BMap 外部调用:传入 BMap 实例(如 ref 的 .value),hook 直接从
 *   window.BMapGL 取 SDK api,map 实例直接复用。
 */
import { useOptionalMapContext } from "../core/context/inject";
import type { MapContext, MapReadyContext } from "../core/context/types";
import { shallowRef, type ShallowRef } from "vue";

export function resolveMapContext(map?: unknown): MapContext {
  const injected = useOptionalMapContext();
  if (injected) return injected;

  // v2 兼容:外部 map 实例(已 ready 的 SDK map)
  const mapRef: ShallowRef<unknown> = shallowRef(map ?? null);
  const apiRef: ShallowRef<unknown> = shallowRef(
    typeof window !== "undefined" ? (window as unknown as Record<string, unknown>).BMapGL ?? null : null,
  );

  const ready = (): MapReadyContext => ({
    api: apiRef.value,
    map: mapRef.value,
  });

  const ctx: MapContext = {
    id: Symbol("external-map-context"),
    status: shallowRef(map ? "ready" : "idle") as unknown as MapContext["status"],
    api: apiRef,
    map: mapRef,
    error: shallowRef(null),
    resources: {
      isDisposed: false,
      signal: undefined as unknown as AbortSignal,
      addEventListener: () => {},
      dispose: () => {},
    } as never,
    events: {} as never,
    scheduler: {} as never,
    overlays: null,
    plugins: null,
    whenReady: (signal?: AbortSignal) =>
      map
        ? Promise.resolve(ready())
        : Promise.reject(
            new Error(
              "BMap map instance is not ready yet. Pass the BMap instance (ref value) or use the hook inside <BMap>.",
            ),
          ),
    dispose: () => {},
  };
  return ctx;
}
