<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onUnmounted, provide, inject } from "vue";
import { mapContextKey, type MapContext, type MapRuntimeStatus } from "../../core/context/types";
import { MapRuntime } from "../../core/runtime/MapRuntime";
import { BMapError } from "../../core/errors/BMapError";
import type { BMapLoadOptions } from "../../core/loader/url";
import { bmapConfigKey, type BMapPluginConfig } from "../../core/context/pluginConfig";
import type { BMapProps } from "../../types/components";

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

const emit = defineEmits<{
  ready: [ctx: { map: unknown; api: unknown }];
  initd: [ctx: { map: unknown; api: unknown }];
  unload: [];
  error: [err: unknown];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const status = ref<MapRuntimeStatus>("idle");
const map = shallowRef<unknown>(null);
const api = shallowRef<unknown>(null);
const error = shallowRef<unknown>(null);

const width = computed(() => (typeof props.width === "number" ? `${props.width}px` : props.width));
const height = computed(() =>
  typeof props.height === "number" ? `${props.height}px` : props.height,
);

let runtime: MapRuntime | null = null;

// app 级默认 provider 配置
const appConfig = inject(bmapConfigKey, undefined) as BMapPluginConfig | undefined;

// 在 setup 阶段同步创建 runtime,使子组件在父 onMounted 之前也能 whenReady
const loadFn =
  props.provider?.load ??
  appConfig?.provider?.load ??
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
    backgroundColor: props.backgroundColor,
    ...opts,
  });
};

const destroyMap = (map: unknown) => {
  const m = map as { destroy?: () => void } | null;
  m?.destroy?.();
};

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
    on ? enable() : disable();
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
runtime = new MapRuntime({
  provider: { load: loadFn },
  providerOptions: loadOptions,
  container: null as unknown as HTMLElement,
  createMap,
  destroyMap,
});

// 容器 ref 挂载后回填,供 MapRuntime.mount 使用
onMounted(() => {
  runtime!.container = containerRef.value!;
  boot().catch(() => {});
});

async function boot() {
  if (runtime!.status.value === "ready") {
    map.value = runtime!.map.value;
    api.value = runtime!.api.value;
    status.value = "ready";
    const payload = { map: runtime!.map.value, api: runtime!.api.value };
    emit("ready", payload);
    emit("initd", payload);
    return;
  }
  status.value = "loading";
  try {
    const ctx = await runtime!.mount();
    map.value = ctx.map;
    api.value = ctx.api;
    status.value = "ready";
    syncEnableProps(map.value);
    const payload = { map: ctx.map, api: ctx.api };
    emit("ready", payload);
    emit("initd", payload);
  } catch (e) {
    error.value = e;
    status.value = "error";
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
  runtime?.dispose();
  runtime = null;
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
  () => syncEnableProps(map.value),
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
  whenReady: (signal?: AbortSignal) => runtime!.whenReady(signal),
  dispose: () => runtime!.dispose(),
};
provide(mapContextKey, context);

defineExpose({
  getMapInstance: () => map.value,
  whenReady: (signal?: AbortSignal) =>
    runtime
      ? runtime.whenReady(signal)
      : Promise.reject(new BMapError("BMAP_RUNTIME_DISPOSED", "not mounted")),
  resetCenter: () => map.value,
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
    ref="containerRef"
    class="bmap-container"
    :style="{ width, height, background: loadingBgColor }"
    style="position: relative; overflow: hidden"
  >
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
