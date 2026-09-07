/**
 * MapContext 解析工具:优先 BMap 注入上下文,否则用外部传入的 map 实例
 * 构造轻量上下文(v2 兼容:useXxx(map) 用法)。
 *
 * - 在 BMap 内部调用:hook 自动获得注入的上下文(推荐)。
 * - 在 BMap 外部调用:传入 BMap ref(如 `const map = ref()`),whenReady
 *   时实时读取 ref.value;API 从 window.BMapGL 取。
 */
import { useOptionalMapContext } from "../core/context/inject";
import type { MapContext, MapReadyContext } from "../core/context/types";
import { shallowRef, toRaw, type ShallowRef } from "vue";

/** 读取外部传入值:ref 实时解包 `.value`,普通对象直接返回 */
function readValue(input: unknown): unknown {
  if (input && typeof input === "object" && "value" in (input as Record<string, unknown>)) {
    return toRaw((input as { value: unknown }).value);
  }
  return input;
}

export function resolveMapContext(map?: unknown): MapContext {
  const injected = useOptionalMapContext();
  if (injected) return injected;

  const apiRef: ShallowRef<unknown> = shallowRef(
    typeof window !== "undefined" ? (window as unknown as Record<string, unknown>).BMapGL ?? null : null,
  );

  const mapRef: ShallowRef<unknown> = shallowRef(readValue(map));
  const statusRef = shallowRef(readValue(map) ? "ready" : "idle") as unknown as MapContext["status"];

  const ready = (): MapReadyContext => ({
    api: apiRef.value,
    map: mapRef.value,
  });

  const ctx: MapContext = {
    id: Symbol("external-map-context"),
    status: statusRef,
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
    whenReady: (signal?: AbortSignal) => {
      // 实时读取(map 参数为 ref 时,组件挂载后 value 才有值;api 同样实时从 window.BMapGL 取)
      mapRef.value = readValue(map);
      apiRef.value =
        typeof window !== "undefined" ? (window as unknown as Record<string, unknown>).BMapGL ?? null : null;
      const value = mapRef.value;
      if (value) {
        statusRef.value = "ready";
        return Promise.resolve(ready());
      }
      return Promise.reject(
        new Error(
          "BMap map instance is not ready yet. Pass the BMap instance (ref value) or use the hook inside <BMap>.",
        ),
      );
    },
    dispose: () => {},
  };
  return ctx;
}
