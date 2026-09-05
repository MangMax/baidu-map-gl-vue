<script setup lang="ts">
import { watch } from "vue";
import { useControlResource } from "../../core/composables/useControlResource";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";

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

type SdkControl = { setValues?: (a: Record<string, unknown>) => void };

const { resource } = useControlResource<BPanoramaControlProps, SdkControl>(props, {
  create: (ctx, p) => {
    const anchor = p.anchor ?? "BMAP_ANCHOR_TOP_LEFT";
    const offset = p.offset ?? { x: 0, y: 0 };
    const BMapGL = ctx.api as {
      PanoramaControl: new (o?: Record<string, unknown>) => unknown;
      Size: new (w: number, h: number) => unknown;
    };
    const win = window as any;
    const anchorValue = win[anchor] ?? anchor;
    return new BMapGL.PanoramaControl({
      offset: new BMapGL.Size(offset.x, offset.y),
      anchor: anchorValue,
    }) as unknown as SdkControl;
  },
  addToMap: (res, ctx, p, scope: ResourceScope) => {
    if (props.visible) (ctx.map as { addControl: (c: unknown) => void }).addControl(res);
    (ctx as any).overlays?.register?.("control", res);
  },
  createWatchers(getCtx, getResource, p, addDisposer) {
    addDisposer(
      watch(
        () => p.visible,
        (v) => {
          const res = getResource();
          const ctx = getCtx();
          if (!res || !ctx) return;
          const map = ctx.map as {
            addControl: (c: unknown) => void;
            removeControl: (c: unknown) => void;
          };
          if (v) map.addControl(res);
          else map.removeControl(res);
        },
      ),
    );
  },
  remove: (res, ctx) => {
    (ctx.map as { removeControl: (c: unknown) => void }).removeControl(res);
  },
});

defineOptions({ name: "BPanoramaControl" });
</script>

<template>
  <slot />
</template>
