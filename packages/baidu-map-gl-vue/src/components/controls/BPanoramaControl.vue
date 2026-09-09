<script setup lang="ts">
import { watch } from "vue";
import { useControlResource } from "../../core/composables/useControlResource";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { ControlHandle } from "../../driver/types/handles";

export interface BPanoramaControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

const props = withDefaults(defineProps<BPanoramaControlProps>(), {
  anchor: "BMAP_ANCHOR_TOP_RIGHT",
  offset: () => ({ x: 10, y: 10 }),
  visible: true,
});

const { resource } = useControlResource<BPanoramaControlProps, ControlHandle>(props, {
  create: (ctx, p) =>
    ctx.client.driver.controls.create("panorama", {
      anchor: p.anchor,
      offset: p.offset,
    }),
  addToMap: (res, ctx, p, scope: ResourceScope) => {
    if (props.visible) ctx.client.driver.controls.add({ kind: "map", handle: ctx.map }, res);
  },
  createWatchers(getCtx, getResource, p, addDisposer) {
    addDisposer(
      watch(
        () => p.visible,
        (v) => {
          const res = getResource();
          const ctx = getCtx();
          if (!res || !ctx) return;
          const controls = ctx.client.driver.controls;
          const target = { kind: "map" as const, handle: ctx.map };
          if (v) controls.add(target, res);
          else controls.remove(target, res);
        },
      ),
    );
  },
  remove: (res, ctx) => {
    ctx.client.driver.controls.remove({ kind: "map", handle: ctx.map }, res);
  },
});

defineOptions({ name: "BPanoramaControl" });
</script>

<template>
  <slot />
</template>
