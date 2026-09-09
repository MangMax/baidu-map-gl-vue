<script setup lang="ts">
import { watch } from "vue";
import { useControlResource } from "../../core/composables/useControlResource";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { ControlHandle } from "../../driver/types/handles";

export interface BZoomProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

const props = withDefaults(defineProps<BZoomProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  offset: () => ({ x: 83, y: 18 }),
  visible: true,
});

const { resource } = useControlResource<BZoomProps, ControlHandle>(props, {
  create: (ctx, p) =>
    ctx.client.driver.controls.create("zoom", {
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

defineOptions({ name: "BZoom" });
</script>

<template>
  <slot />
</template>
