<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onUnmounted, provide, inject } from "vue";
import { mapContextKey, type MapContext, type MapReadyContext } from "../../core/context/types";
import { MapRuntime } from "../../core/runtime/MapRuntime";
import { BMapError } from "../../core/errors/BMapError";
import { bindSdkEvent, type BMapSdkEventTarget } from "../../core/events/EventBridge";
import type { BMapLoadOptions } from "../../core/loader/url";
import { bmapConfigKey, type BMapPluginConfig } from "../../core/context/pluginConfig";
import type { BMapProps } from "../../types/components";
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
  pluginReady: [map: unknown];
  "plugin-ready": [name: string];
  "plugin-error": [payload: { name: string; error: unknown }];
  click: [event: unknown];
  unload: [];
  error: [err: unknown];
}>();

const containerRef = ref<HTMLDivElement | null>(null);

// P0-04: 不再复制 Runtime 状态，直接复用 runtime refs
const runtimeRef = shallowRef<MapRuntime | null>(null);

const status = computed(() => runtimeRef.value?.status.value ?? "idle");
const map = computed(() => runtimeRef.value?.map.value ?? null);
const api = computed(() => runtimeRef.value?.api.value ?? null);
const error = computed(() => runtimeRef.value?.error.value ?? null);

const width = computed(() => (typeof props.width === "number" ? `${props.width}px` : props.width));
const height = computed(() =>
  typeof props.height === "number" ? `${props.height}px` : props.height,
);

// app 级默认 provider 配置
const appConfig = inject(bmapConfigKey, undefined) as BMapPluginConfig | undefined;

// 在 setup 阶段同步创建 runtime,使子组件在父 onMounted 之前也能 whenReady
const loadFn =
  props.provider?.load ??
  (appConfig?.provider?.load
    ? (opts: BMapLoadOptions = {}, signal?: AbortSignal) => appConfig!.provider!.load(opts, signal)
    : undefined) ??
  ((opts?: unknown, signal?: AbortSignal) => {
    const existing = (window as any).BMapGL;
    if (!existing) {
      return Promise.reject(
        new BMapError(
          "BMAP_SDK_LOAD_FAILED",
          "BMap requires an AK via createBMapPlugin, a provider prop, or window.BMapGL",
        ),
      );
    }
    return Promise.resolve(existing);
  });

const loadOptions: BMapLoadOptions = {
  ak: props.ak ?? appConfig?.defaults?.ak,
  apiUrl: props.apiUrl ?? appConfig?.defaults?.apiUrl,
  version: appConfig?.defaults?.version ?? "1.0",
};

const createMap = (sdkApi: unknown, container: HTMLElement, opts?: Record<string, unknown>) => {
  const BMapGL = sdkApi as { Map: new (el: HTMLElement, o?: Record<string, unknown>) => unknown };
  return new BMapGL.Map(container, {
    minZoom: props.minZoom,
    maxZoom: props.maxZoom,
    restrictCenter: props.restrictCenter,
    displayOptions: props.displayOptions,
    backgroundColor: props.backgroundColor,
    ...opts,
  });
};

const destroyMap = (map: unknown) => {
  const m = map as { destroy?: () => void } | null;
  m?.destroy?.();
};

type SdkView = {
  centerAndZoom?: (center: unknown, zoom: number) => void;
  setCenter?: (center: unknown) => void;
  setZoom?: (zoom: number) => void;
  setHeading?: (heading: number) => void;
  setTilt?: (tilt: number) => void;
  setView?: (center: unknown, zoom: number) => void;
  setMapStyleV2?: (config: Record<string, unknown>) => void;
};

function normalizeCenter(value: unknown): unknown {
  return value;
}

/** P0-01/P0-02: 初始化视角只走一次 centerAndZoom + heading/tilt */
function initializeView(target: unknown) {
  const m = target as SdkView | null;
  if (!m) return;
  if (props.center !== undefined && props.zoom !== undefined) {
    m.centerAndZoom?.(normalizeCenter(props.center), props.zoom);
  }
  if (props.heading != null) {
    m.setHeading?.(props.heading);
  }
  if (props.tilt != null) {
    m.setTilt?.(props.tilt);
  }
}

// 初始视角快照，供 resetView 恢复
let initialViewSnapshot: { center: unknown; zoom: number; heading?: number; tilt?: number } | null =
  null;

function captureInitialView() {
  initialViewSnapshot = {
    center:
      typeof props.center === "string"
        ? props.center
        : { ...(props.center as { lng: number; lat: number }) },
    zoom: props.zoom as number,
    heading: props.heading,
    tilt: props.tilt,
  };
}

/** v2 风格地图类型字符串 → SDK 顶层常量字符串(如 BMapGL.BMAP_SATELLITE_MAP) */
function toSdkMapType(value: string | undefined): string {
  const map: Record<string, string> = {
    BMAP_NORMAL_MAP: "B_NORMAL_MAP",
    BMAP_EARTH_MAP: "B_EARTH_MAP",
    BMAP_SATELLITE_MAP: "B_SATELLITE_MAP",
  };
  return map[value ?? "BMAP_NORMAL_MAP"] ?? "B_NORMAL_MAP";
}

/** 将 mapType prop 同步为 SDK setMapType(SDK 接受顶层字符串常量,MapTypeId.SATELLITE 是错的) */
function applyMapType(target: unknown, sdkApi: unknown) {
  const m = target as { setMapType?: (t: unknown) => void } | null;
  if (!m?.setMapType) return;
  const sdkKey = toSdkMapType(props.mapType);
  m.setMapType(sdkKey);
}

// enableXxx 布尔开关 → SDK enableXxx/disableXxx 方法名映射
function mapMethods(m: unknown) {
  return m as
    | {
        enableDragging?: () => void;
        disableDragging?: () => void;
        enableScrollWheelZoom?: () => void;
        disableScrollWheelZoom?: () => void;
        enableInertialDragging?: () => void;
        disableInertialDragging?: () => void;
        enablePinchToZoom?: () => void;
        disablePinchToZoom?: () => void;
        enableKeyboard?: () => void;
        disableKeyboard?: () => void;
        enableDoubleClickZoom?: () => void;
        disableDoubleClickZoom?: () => void;
        enableContinuousZoom?: () => void;
        disableContinuousZoom?: () => void;
        enableResizeOnCenter?: () => void;
        disableResizeOnCenter?: () => void;
        setTrafficOn?: () => void;
        setTrafficOff?: () => void;
      }
    | null;
}

/** 将 props 上的 enableXxx 布尔值同步到 SDK map 实例 */
function syncEnableProps(target: unknown) {
  if (!target) return;
  const m = mapMethods(target);
  const set = (
    on: boolean | undefined,
    enable?: () => void,
    disable?: () => void,
  ) => {
    if (on === undefined || !enable || !disable) return;
    on ? enable.call(m) : disable.call(m);
  };
  set(props.enableDragging, m?.enableDragging, m?.disableDragging);
  set(props.enableScrollWheelZoom, m?.enableScrollWheelZoom, m?.disableScrollWheelZoom);
  set(props.enableInertialDragging, m?.enableInertialDragging, m?.disableInertialDragging);
  set(props.enablePinchToZoom, m?.enablePinchToZoom, m?.disablePinchToZoom);
  set(props.enableKeyboard, m?.enableKeyboard, m?.disableKeyboard);
  set(props.enableDoubleClickZoom, m?.enableDoubleClickZoom, m?.disableDoubleClickZoom);
  set(props.enableContinuousZoom, m?.enableContinuousZoom, m?.disableContinuousZoom);
  set(props.enableResizeOnCenter, m?.enableResizeOnCenter, m?.disableResizeOnCenter);
  set(props.enableTraffic, m?.setTrafficOn, m?.setTrafficOff);
}

// runtime 立即创建(container 在模板 ref,挂载后才有;mount 时使用)
const currentRuntime = new MapRuntime({
  provider: { load: loadFn },
  providerOptions: loadOptions,
  container: null as unknown as HTMLElement,
  createMap,
  destroyMap,
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

/** P0-05: 插件不阻塞 map ready；ready 后台加载插件并逐个 emit */
async function loadPluginsInBackground(ctx: MapReadyContext) {
  for (const name of props.plugins ?? []) {
    try {
      await runtime.plugins.whenPlugin(name, runtime.resources.signal);
      emit("plugin-ready", name);
      // 兼容旧驼峰事件
      emit("pluginReady", ctx.map);
    } catch (e) {
      const err =
        e instanceof BMapError
          ? e
          : new BMapError("BMAP_RESOURCE_CREATE_FAILED", `plugin ${name} failed`, { cause: e });
      emit("plugin-error", { name, error: err });
    }
  }
}

function applyStyleProps(target: unknown) {
  const m = target as SdkView | null;
  if (!m) return;
  const styleTarget = m as { setMapStyleV2?: (config: Record<string, unknown>) => void };
  if (props.mapStyleJson) {
    styleTarget.setMapStyleV2?.(props.mapStyleJson);
  } else if (props.mapStyleId) {
    styleTarget.setMapStyleV2?.({ styleId: props.mapStyleId });
  }
}

async function boot() {
  if (runtime.status.value === "ready") {
    const payload = {
      map: runtime.map.value,
      api: runtime.api.value,
      container: containerRef.value!,
    };
    emit("ready", payload);
    emit("initd", payload);
    void loadPluginsInBackground({ map: runtime.map.value, api: runtime.api.value });
    return;
  }
  try {
    const ctx = await runtime.mount();
    captureInitialView();
    // map-initializing: centerAndZoom、heading、tilt、options 正在应用
    initializeView(ctx.map);
    applyStyleProps(ctx.map);
    applyMapType(ctx.map, ctx.api);
    syncEnableProps(ctx.map);
    const mapEventTarget = ctx.map as {
      addEventListener?: (type: string, listener: (event: unknown) => void) => void;
      removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
    };
    if (mapEventTarget.addEventListener && mapEventTarget.removeEventListener) {
      runtime.resources.add(
        bindSdkEvent(mapEventTarget as BMapSdkEventTarget, "click", (event) => emit("click", event)),
      );
    }
    const payload = { map: ctx.map, api: ctx.api, container: containerRef.value! };
    // P0-05: Map ready 不等待 optional plugin
    emit("ready", payload);
    emit("initd", payload);
    // 插件后台加载，逐个回执
    void loadPluginsInBackground(ctx);
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
    syncEnableProps(map.value);
  },
  { flush: "post" },
);

// props.mapType 变化时同步 SDK
watch(
  () => props.mapType,
  () => applyMapType(map.value, api.value),
  { flush: "post" },
);

// P0-01: 后续 center 更新只 setCenter，不重置 zoom；分别监听 lng/lat，禁止 deep
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
    const handle = map.value as SdkView | null;
    if (!handle) return;
    if (typeof props.center === "string") {
      if (props.center === oldLng) return;
      handle.setCenter?.(normalizeCenter(props.center));
      return;
    }
    if (lng == null || lat == null) return;
    if (lng === oldLng && lat === oldLat) return;
    handle.setCenter?.(normalizeCenter(props.center));
  },
  { flush: "post" },
);

// P0-01: zoom 单独更新只 setZoom
watch(
  () => props.zoom,
  (value, previous) => {
    if (value == null || value === previous) return;
    const handle = map.value as SdkView | null;
    if (!handle) return;
    handle.setZoom?.(value);
  },
  { flush: "post" },
);

// P0-02: heading/tilt 外部更新同步（SDK 支持才调用）
watch(
  () => props.heading,
  (value, previous) => {
    if (value == null || value === previous) return;
    const handle = map.value as SdkView | null;
    handle?.setHeading?.(value);
  },
  { flush: "post" },
);

watch(
  () => props.tilt,
  (value, previous) => {
    if (value == null || value === previous) return;
    const handle = map.value as SdkView | null;
    handle?.setTilt?.(value);
  },
  { flush: "post" },
);

const context: MapContext = {
  id: runtime.id,
  status: status as unknown as MapContext["status"],
  api: api as unknown as MapContext["api"],
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

/** P0-03: 真正重置视角到初始快照 */
function resetView() {
  const handle = map.value as SdkView | null;
  if (!handle || !initialViewSnapshot) return;
  const { center, zoom, heading, tilt } = initialViewSnapshot;
  if (handle.setView) {
    handle.setView(normalizeCenter(center), zoom);
  } else {
    handle.centerAndZoom?.(normalizeCenter(center), zoom);
  }
  if (heading != null) handle.setHeading?.(heading);
  if (tilt != null) handle.setTilt?.(tilt);
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
    const m = map.value as { enableDragging?: () => void; disableDragging?: () => void } | null;
    if (!m) return;
    enabled ? m.enableDragging?.() : m.disableDragging?.();
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
    <slot :status="status" :map="map" :error="error" :api="api" />
  </div>
</template>
