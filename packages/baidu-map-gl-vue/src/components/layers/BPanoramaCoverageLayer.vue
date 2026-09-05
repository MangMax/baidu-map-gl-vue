<script setup lang="ts">
import { useLayerResource } from "../../core/composables/useLayerResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";

/**
 * M6-04: BPanoramaCoverageLayer 迁移
 *
 * 全景覆盖图层,经 map.addTileLayer/removeTileLayer 管理。
 */
const props = defineProps({});

type SdkLayer = { setOptions?: (o: Record<string, unknown>) => void };

const { resource } = useLayerResource<Record<string, never>, SdkLayer>(
  props as Record<string, never>,
  {
    create: (ctx) => {
      return new (ctx.api as any).PanoramaCoverageLayer() as unknown as SdkLayer;
    },
    addToMap: (res, ctx) => {
      (ctx.map as { addTileLayer: (l: unknown) => void }).addTileLayer(res);
      (ctx as any).overlays?.register?.("panorama-coverage", res);
    },
    remove: (res, ctx) => {
      (ctx.map as { removeTileLayer: (l: unknown) => void }).removeTileLayer(res);
    },
  },
);

defineOptions({ name: "BPanoramaCoverageLayer" });
</script>

<template>
  <slot />
</template>
