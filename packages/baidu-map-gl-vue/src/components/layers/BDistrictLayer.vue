<script setup lang="ts">
import { watch } from "vue";
import { useLayerResource } from "../../core/composables/useLayerResource";
import { useRequiredMapContext } from "../../core/context/inject";
import { bindSdkEvent } from "../../core/events/EventBridge";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";

export type DistrictType = 0 | 1 | 2;

export interface BDistrictLayerProps {
  visible?: boolean;
  name: string;
  kind?: DistrictType;
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWeight?: number;
  strokeOpacity?: number;
  viewport?: boolean;
}

const props = withDefaults(defineProps<BDistrictLayerProps>(), {
  kind: 0,
  visible: true,
  fillColor: "#fdfd27",
  fillOpacity: 1,
  strokeWeight: 1,
  strokeOpacity: 1,
  strokeColor: "#231cf8",
  viewport: false,
});

const emit = defineEmits<{
  click: [e: unknown];
  mouseover: [e: unknown];
  mouseout: [e: unknown];
}>();

type SdkDistrictLayer = { onload?: (cb: () => void) => void };

// 组件级 map context:用于 visible 切换
const mapCtx = useRequiredMapContext();

const { resource } = useLayerResource<BDistrictLayerProps, SdkDistrictLayer>(props, {
  create: (ctx, p) => {
    const BMapGL = ctx.api as { DistrictLayer: new (o?: Record<string, unknown>) => unknown };
    if (!p.name) throw new Error("DistrictLayer props.name is required");
    return new BMapGL.DistrictLayer({
      name: `(${p.name})`,
      kind: p.kind,
      fillColor: p.fillColor,
      fillOpacity: p.fillOpacity,
      strokeColor: p.strokeColor,
      strokeOpacity: p.strokeOpacity,
      strokeWeight: p.strokeWeight,
      viewport: p.viewport,
    }) as unknown as SdkDistrictLayer;
  },
  addToMap: (res, ctx) => {
    if (props.visible)
      (ctx.map as { addDistrictLayer: (l: unknown) => void }).addDistrictLayer(res);
    (ctx as any).overlays?.register?.("district-layer", res);
  },
  createWatchers(res, ctx: MapReadyContext, p, scope: ResourceScope) {
    scope.add(bindSdkEvent(res as any, "click", (e) => emit("click", e)));
    scope.add(bindSdkEvent(res as any, "mouseover", (e) => emit("mouseover", e)));
    scope.add(bindSdkEvent(res as any, "mouseout", (e) => emit("mouseout", e)));
  },
  remove: (res, ctx) => {
    (ctx.map as { removeDistrictLayer: (l: unknown) => void }).removeDistrictLayer(res);
  },
});

// 组件级 visible 切换:在 setup 顶部同步注册,保证响应式
watch(
  () => props.visible,
  (visible) => {
    const layer = resource.value as any;
    if (!layer) return;
    const map = mapCtx.map.value as {
      addDistrictLayer: (l: unknown) => void;
      removeDistrictLayer: (l: unknown) => void;
    };
    if (!map) return;
    if (visible) map.addDistrictLayer(layer);
    else map.removeDistrictLayer(layer);
  },
);

defineOptions({ name: "BDistrictLayer" });
</script>

<template>
  <slot />
</template>
