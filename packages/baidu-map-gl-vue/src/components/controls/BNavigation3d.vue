<script setup lang="ts">
import { watch } from "vue";
import { useControlResource } from "../../core/composables/useControlResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";

export interface BNavigation3dProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

const props = withDefaults(defineProps<BNavigation3dProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  offset: () => ({ x: 83, y: 18 }),
  visible: true,
});

type SdkControl = { setOptions?: (o: Record<string, unknown>) => void };

const { resource } = useControlResource<BNavigation3dProps, SdkControl>(props, {
  create: (ctx, p) => {
    const anchor = p.anchor ?? "BMAP_ANCHOR_TOP_LEFT";
    const offset = p.offset ?? { x: 0, y: 0 };
    const win = window as any;
    return new (ctx.api as any).NavigationControl3D({
      offset: new (ctx.api as any).Size(offset.x, offset.y),
      anchor: win[anchor] ?? anchor,
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

defineOptions({ name: "BNavigation3d" });
</script>

<template>
  <slot />
</template>
