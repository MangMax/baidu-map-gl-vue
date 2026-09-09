<script setup lang="ts">
import { watch } from "vue";
import { useControlResource } from "../../core/composables/useControlResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { ControlHandle } from "../../driver/types/handles";

export interface BCityListProps {
  anchor?: string;
  offset?: { x: number; y: number };
  expand?: boolean;
  visible?: boolean;
}

const props = withDefaults(defineProps<BCityListProps>(), {
  anchor: "BMAP_ANCHOR_TOP_LEFT",
  offset: () => ({ x: 18, y: 18 }),
  expand: false,
  visible: true,
});

const { resource } = useControlResource<BCityListProps, ControlHandle>(props, {
  create: (ctx, p) =>
    ctx.client.driver.controls.create("city-list", {
      anchor: p.anchor,
      offset: p.offset,
      expand: p.expand,
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

defineOptions({ name: "BCityList" });
</script>

<template>
  <slot />
</template>
