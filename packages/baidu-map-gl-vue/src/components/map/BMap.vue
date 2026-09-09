<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onUnmounted, provide, inject } from "vue";
import { mapContextKey, type MapContext, type MapReadyContext } from "../../core/context/types";
import { MapRuntime } from "../../core/runtime/MapRuntime";
import { BMapError } from "../../core/errors/BMapError";
import type { BMapLoadOptions } from "../../core/loader/url";
import { existingGlobalProvider, type BMapProvider } from "../../core/loader/Provider";
import { createBMapClient, type BMapProviderLike } from "../../client";
import { normalizeMapMouseEvent } from "../../driver/normalize";
import { bmapConfigKey, type BMapPluginConfig } from "../../core/context/pluginConfig";
import type { BMapProps } from "../../types/components";
import type { MapInteraction, MapType } from "../../driver/types/map";
import { stringToPluginDefinitions } from "../../plugins/builtins";

export type { BMapProps };

const props = withDefaults(defineProps<BMapProps>(), {
  zoom: 14,
  center: () => ({ lat: 39.915185, lng: 116.403901 }),
  width: "100%",
  height: "550px",
  mapType: "BMAP_NORMAL_MAP",
  heading: 0,
  tilt: 0,
  minZoom: 0,
  maxZoom: 21,
  noAnimation: false,
  enableDragging: true,
  enableScrollWheelZoom: false,
  loadingBgColor: "#f1f1f1",
});

export interface MapReadyPayload extends MapReadyContext {
  container: HTMLElement;
}

const emit = defineEmits<{
  ready: [payload: MapReadyPayload];
  initd: [payload: MapReadyPayload];
  "plugin-ready": [name: string];
  "plugin-error": [payload: { name: string; error: unknown }];
  click: [event: unknown];
  unload: [];
  error: [err: unknown];
}>();

const containerRef = ref<HTMLDivElement | null>(null);

// 不再复制 Runtime 状态，直接复用 runtime refs
const runtimeRef = shallowRef<MapRuntime | null>(null);

const status = computed(() => runtimeRef.value?.status.value ?? "idle");
const map = computed(() => runtimeRef.value?.map.value ?? null);
const client = computed(() => runtimeRef.value?.client.value ?? null);
const error = computed(() => runtimeRef.value?.error.value ?? null);

const width = computed(() => (typeof props.width === "number" ? `${props.width}px` : props.width));
const height = computed(() =>
  typeof props.height === "number" ? `${props.height}px` : props.height,
);

// app 级默认 provider 配置
const appConfig = inject(bmapConfigKey, undefined) as BMapPluginConfig | undefined;

// Provider 解析：显式 provider prop > app.use 默认 > 已存在全局（经 loader 边界）
const provider: BMapProviderLike =
  props.provider ??
  (appConfig?.provider?.load
    ? appConfig.provider
    : (existingGlobalProvider() as unknown as BMapProvider));

const loadOptions: BMapLoadOptions = {
  ak: props.ak ?? appConfig?.defaults?.ak,
  apiUrl: props.apiUrl ?? appConfig?.defaults?.apiUrl,
  version: appConfig?.defaults?.version ?? "1.0",
};

const clientFactory = (signal?: AbortSignal) =>
  createBMapClient({ provider, loadOptions }, signal);

// 初始视角快照，供 resetView 恢复
const initialViewSnapshot: {
  center: { lng: number; lat: number } | string;
  zoom: number;
  heading?: number;
  tilt?: number;
} = {
  center:
    typeof props.center === "string"
      ? props.center
      : { ...(props.center as { lng: number; lat: number }) },
  zoom: props.zoom as number,
  heading: props.heading,
  tilt: props.tilt,
};

/** v2 风格地图类型字符串 → 语义 MapType */
function toMapType(value: string | undefined): MapType {
  const map: Record<string, MapType> = {
    BMAP_NORMAL_MAP: "normal",
    BMAP_EARTH_MAP: "earth",
    BMAP_SATELLITE_MAP: "satellite",
  };
  return map[value ?? "BMAP_NORMAL_MAP"] ?? "normal";
}

/** 将 mapType prop 同步为 SDK setMapType */
function applyMapType(ctx: MapReadyContext) {
  ctx.client.driver.map.setMapType(ctx.map, toMapType(props.mapType));
}

/** enableXxx 布尔开关 → 语义 interaction */
const INTERACTION_PROPS: Array<[keyof BMapProps, MapInteraction]> = [
  ["enableDragging", "dragging"],
  ["enableScrollWheelZoom", "scroll-zoom"],
  ["enableInertialDragging", "inertial-dragging"],
  ["enablePinchToZoom", "pinch-zoom"],
  ["enableKeyboard", "keyboard"],
  ["enableDoubleClickZoom", "double-click-zoom"],
  ["enableContinuousZoom", "continuous-zoom"],
  ["enableResizeOnCenter", "resize-on-center"],
];

/** 将 props 上的 enableXxx 布尔值同步到 SDK map 实例 */
function syncEnableProps(ctx: MapReadyContext) {
  for (const [prop, interaction] of INTERACTION_PROPS) {
    const value = props[prop];
    if (value === undefined) continue;
    ctx.client.driver.map.setInteraction(ctx.map, interaction, Boolean(value));
  }
  if (props.enableTraffic !== undefined) {
    ctx.client.driver.map.setTraffic(ctx.map, props.enableTraffic);
  }
}

function applyStyleProps(ctx: MapReadyContext) {
  if (props.mapStyleJson) {
    ctx.client.driver.map.setMapStyle(ctx.map, props.mapStyleJson);
  } else if (props.mapStyleId) {
    ctx.client.driver.map.setMapStyle(ctx.map, { styleId: props.mapStyleId });
  }
}

// runtime 立即创建(container 在模板 ref,挂载后才有;mount 时使用)
const currentRuntime = new MapRuntime({
  clientFactory,
  container: null as unknown as HTMLElement,
  mapOptions: {
    minZoom: props.minZoom,
    maxZoom: props.maxZoom,
    restrictCenter: props.restrictCenter,
    displayOptions: props.displayOptions,
    backgroundColor: props.backgroundColor,
  },
});
for (const definition of stringToPluginDefinitions(props.plugins ?? [])) {
  currentRuntime.plugins.register(definition);
}
runtimeRef.value = currentRuntime;
const runtime = currentRuntime;

// 容器 ref 挂载后回填,供 MapRuntime.mount 使用
onMounted(() => {
  runtime.container = containerRef.value!;
  boot().catch(() => {});
});

/** 插件不阻塞 map ready；ready 后台加载插件并逐个 emit */
async function loadPluginsInBackground() {
  for (const name of props.plugins ?? []) {
    try {
      await runtime.plugins.whenPlugin(name, runtime.resources.signal);
      // 只发 kebab 规范事件：Vue 会把 `plugin-ready` 回退匹配到 `@pluginReady`
      // 监听器，双事件会导致同一监听器被调两次（一次 name、一次 map）
      emit("plugin-ready", name);
    } catch (e) {
      const err =
        e instanceof BMapError
          ? e
          : new BMapError("BMAP_RESOURCE_CREATE_FAILED", `plugin ${name} failed`, { cause: e });
      emit("plugin-error", { name, error: err });
    }
  }
}

async function boot() {
  if (runtime.status.value === "ready") {
    const payload = {
      client: runtime.client.value!,
      map: runtime.map.value!,
      container: containerRef.value!,
    };
    emit("ready", payload);
    emit("initd", payload);
    void loadPluginsInBackground();
    return;
  }
  try {
    const ctx = await runtime.mount();
    // map-initializing: centerAndZoom、heading、tilt、options 正在应用
    ctx.client.driver.map.initializeView(ctx.map, initialViewSnapshot);
    applyStyleProps(ctx);
    applyMapType(ctx);
    syncEnableProps(ctx);
    runtime.resources.add(
      ctx.client.driver.events.on(ctx.map, "click", (event) => {
        emit("click", normalizeMapMouseEvent(event, ctx.client.driver.geometry));
      }),
    );
    const payload = { client: ctx.client, map: ctx.map, container: containerRef.value! };
    // Map ready 不等待 optional plugin
    emit("ready", payload);
    emit("initd", payload);
    // 插件后台加载，逐个回执
    void loadPluginsInBackground();
  } catch (e) {
    emit(
      "error",
      e instanceof BMapError
        ? e
        : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(e), { cause: e }),
    );
    throw e;
  }
}

onUnmounted(() => {
  runtime.dispose();
  runtimeRef.value = null;
  emit("unload");
});

// props.enableXxx 变化时同步 SDK
watch(
  () => [
    props.enableDragging,
    props.enableScrollWheelZoom,
    props.enableInertialDragging,
    props.enablePinchToZoom,
    props.enableKeyboard,
    props.enableDoubleClickZoom,
    props.enableContinuousZoom,
    props.enableResizeOnCenter,
    props.enableTraffic,
  ],
  () => {
    const ready = runtimeRef.value;
    const m = map.value;
    const c = client.value;
    if (!ready || !m || !c) return;
    syncEnableProps({ client: c, map: m });
  },
  { flush: "post" },
);

// props.mapType 变化时同步 SDK
watch(
  () => props.mapType,
  () => {
    const m = map.value;
    const c = client.value;
    if (!m || !c) return;
    applyMapType({ client: c, map: m });
  },
  { flush: "post" },
);

// 后续 center 更新只 setCenter，不重置 zoom；分别监听 lng/lat，禁止 deep
function centerLng(value: BMapProps["center"]): number | string | undefined {
  if (typeof value === "string") return value;
  return value?.lng;
}
function centerLat(value: BMapProps["center"]): number | undefined {
  if (typeof value === "string") return undefined;
  return (value as { lat?: number } | undefined)?.lat;
}
watch(
  [() => centerLng(props.center), () => centerLat(props.center)],
  ([lng, lat], [oldLng, oldLat]) => {
    const m = map.value;
    const c = client.value;
    if (!m || !c) return;
    if (typeof props.center === "string") {
      if (props.center === oldLng) return;
      c.driver.map.setCenter(m, props.center);
      return;
    }
    if (lng == null || lat == null) return;
    if (lng === oldLng && lat === oldLat) return;
    c.driver.map.setCenter(m, { lng: lng as number, lat });
  },
  { flush: "post" },
);

// zoom 单独更新只 setZoom
watch(
  () => props.zoom,
  (value, previous) => {
    if (value == null || value === previous) return;
    const m = map.value;
    const c = client.value;
    if (!m || !c) return;
    c.driver.map.setZoom(m, value);
  },
  { flush: "post" },
);

// heading/tilt 外部更新同步（SDK 支持才调用）
watch(
  () => props.heading,
  (value, previous) => {
    if (value == null || value === previous) return;
    const m = map.value;
    const c = client.value;
    if (!m || !c) return;
    c.driver.map.setHeading(m, value);
  },
  { flush: "post" },
);

watch(
  () => props.tilt,
  (value, previous) => {
    if (value == null || value === previous) return;
    const m = map.value;
    const c = client.value;
    if (!m || !c) return;
    c.driver.map.setTilt(m, value);
  },
  { flush: "post" },
);

const context: MapContext = {
  id: runtime.id,
  status: status as unknown as MapContext["status"],
  client: client as unknown as MapContext["client"],
  map: map as unknown as MapContext["map"],
  error: error as unknown as MapContext["error"],
  resources: runtime.resources,
  events: runtime.events,
  scheduler: runtime.scheduler,
  overlays: runtime.overlays,
  plugins: runtime.plugins,
  whenReady: (signal?: AbortSignal) => runtime.whenReady(signal),
  dispose: () => runtime.dispose(),
};
provide(mapContextKey, context);

/** 真正重置视角到初始快照 */
function resetView() {
  const m = map.value;
  const c = client.value;
  if (!m || !c || !initialViewSnapshot) return;
  c.driver.map.initializeView(m, initialViewSnapshot);
}

defineExpose({
  getMapInstance: () => map.value,
  getContainer: () => containerRef.value,
  whenReady: (signal?: AbortSignal) => runtime.whenReady(signal),
  resetView,
  /** @deprecated Use resetView() instead. */
  resetCenter: () => {
    resetView();
  },
  setDragging: (enabled: boolean) => {
    const m = map.value;
    const c = client.value;
    if (!m || !c) return;
    c.driver.map.setInteraction(m, "dragging", enabled);
  },
});

defineOptions({ name: "BMap" });
</script>

<template>
  <div
    class="bmap-container"
    :style="{ width, height, background: loadingBgColor }"
    style="position: relative; overflow: hidden"
  >
    <div ref="containerRef" class="bmap-canvas-host" style="position: absolute; inset: 0" />
    <slot name="loading" :status="status" :error="error">
      <div
        v-if="status !== 'ready'"
        :style="{
          color: '#999',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
        }"
      >
        {{ status === "loading" ? "map loading..." : status === "error" ? "map error" : "" }}
      </div>
    </slot>
    <slot :status="status" :map="map" :error="error" :client="client" />
  </div>
</template>
