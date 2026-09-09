<script setup lang="ts">
import { watch } from "vue";
import { useLayerResource } from "../../core/composables/useLayerResource";
import { useRequiredMapContext } from "../../core/context/inject";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { LayerHandle } from "../../driver/types/handles";
import type { DistrictTypeValue } from "../../types/components";

export type DistrictType = DistrictTypeValue;

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

// 组件级 map context:用于 visible 切换
const mapCtx = useRequiredMapContext();

const { resource } = useLayerResource<BDistrictLayerProps, LayerHandle>(props, {
  create: (ctx, p) => {
    if (!p.name) throw new Error("DistrictLayer props.name is required");
    return ctx.client.driver.layers.create("district", {
      name: `(${p.name})`,
      kind: p.kind,
      fillColor: p.fillColor,
      fillOpacity: p.fillOpacity,
      strokeColor: p.strokeColor,
      strokeOpacity: p.strokeOpacity,
      strokeWeight: p.strokeWeight,
      viewport: p.viewport,
    });
  },
  addToMap: (res, ctx) => {
    if (props.visible) ctx.client.driver.layers.add({ kind: "map", handle: ctx.map }, res);
  },
  createWatchers(res, ctx: MapReadyContext, p, scope: ResourceScope) {
    scope.add(ctx.client.driver.events.on(res, "click", (e) => emit("click", e)));
    scope.add(ctx.client.driver.events.on(res, "mouseover", (e) => emit("mouseover", e)));
    scope.add(ctx.client.driver.events.on(res, "mouseout", (e) => emit("mouseout", e)));
  },
  remove: (res, ctx) => {
    ctx.client.driver.layers.remove({ kind: "map", handle: ctx.map }, res);
  },
});

// 组件级 visible 切换:在 setup 顶部同步注册,保证响应式
watch(
  () => props.visible,
  (visible) => {
    const layer = resource.value;
    const map = mapCtx.map.value;
    const client = mapCtx.client.value;
    if (!layer || !map || !client) return;
    const target = { kind: "map" as const, handle: map };
    if (visible) client.driver.layers.add(target, layer);
    else client.driver.layers.remove(target, layer);
  },
);

defineOptions({ name: "BDistrictLayer" });
</script>

<template>
  <slot />
</template>
