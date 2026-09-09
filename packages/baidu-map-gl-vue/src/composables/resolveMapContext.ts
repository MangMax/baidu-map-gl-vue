/**
 * MapContext 解析工具:优先 BMap 注入上下文,否则用外部传入的 map 实例
 * 构造轻量上下文(v2 兼容:useXxx(map) 用法)。
 *
 * - 在 BMap 内部调用:hook 自动获得注入的上下文(推荐)。
 * - 在 BMap 外部调用:传入 BMap ref(如 `const map = ref()`),whenReady
 *   时实时读取 ref.value;client 经 loader 边界(existingGlobalProvider)创建。
 */
import { useOptionalMapContext } from "../core/context/inject";
import type { MapContext, MapReadyContext } from "../core/context/types";
import { shallowRef, toRaw, type ShallowRef } from "vue";
import { createBMapClient } from "../client";
import { existingGlobalProvider } from "../core/loader/Provider";
import { createHandle, type MapHandle } from "../driver/types/handles";
import type { BMapClient } from "../client/types";

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

  const mapRef: ShallowRef<MapHandle | null> = shallowRef(null);
  const clientRef = shallowRef<BMapClient | null>(null);
  const statusRef = shallowRef("idle") as unknown as MapContext["status"];
  let readyPromise: Promise<MapReadyContext> | null = null;

  const getReady = (): Promise<MapReadyContext> => {
    if (!readyPromise) {
      readyPromise = (async () => {
        const rawMap = readValue(map);
        if (!rawMap) {
          throw new Error(
            "BMap map instance is not ready yet. Pass the BMap instance (ref value) or use the hook inside <BMap>.",
          );
        }
        const client = await createBMapClient({
          provider: existingGlobalProvider(),
          loadOptions: {},
        });
        const handle = createHandle("map", rawMap);
        mapRef.value = handle;
        clientRef.value = client;
        statusRef.value = "ready";
        return { client, map: handle };
      })();
    }
    return readyPromise;
  };

  const ctx: MapContext = {
    id: Symbol("external-map-context"),
    status: statusRef,
    client: clientRef as unknown as MapContext["client"],
    map: mapRef as unknown as MapContext["map"],
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
    whenReady: () => getReady(),
    dispose: () => {},
  };
  return ctx;
}
