<script setup lang="ts">
import { useLayerResource } from "../../core/composables/useLayerResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { LayerHandle } from "../../driver/types/handles";

/**
 * BPanoramaCoverageLayer 迁移
 *
 * 全景覆盖图层,经 map.addTileLayer/removeTileLayer 管理。
 */
const props = defineProps({});

const { resource } = useLayerResource<Record<string, never>, LayerHandle>(
  props as Record<string, never>,
  {
    create: (ctx) => ctx.client.driver.layers.create("panorama-coverage"),
    addToMap: (res, ctx) => {
      ctx.client.driver.layers.add({ kind: "map", handle: ctx.map }, res);
    },
    remove: (res, ctx) => {
      ctx.client.driver.layers.remove({ kind: "map", handle: ctx.map }, res);
    },
  },
);

defineOptions({ name: "BPanoramaCoverageLayer" });
</script>

<template>
  <slot />
</template>
