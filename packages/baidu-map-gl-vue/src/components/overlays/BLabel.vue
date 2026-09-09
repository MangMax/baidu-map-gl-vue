<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { LabelHandle } from "../../driver/types/handles";

export type LabelStyle = Record<string, any>;
export interface BLabelProps {
  content: string;
  position: { lng: number; lat: number };
  offset?: { x: number; y: number };
  zIndex?: number;
  style?: LabelStyle;
  enableMassClear?: boolean;
  visible?: boolean;
}

const props = withDefaults(defineProps<BLabelProps>(), {
  offset: () => ({ x: 0, y: 0 }),
  enableMassClear: true,
  visible: true,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
}>();

const { resource } = useOverlayResource<BLabelProps, LabelHandle>(
  props,
  {
    create: (ctx, p) =>
      ctx.client.driver.overlays.createLabel(p.content, {
        position: p.position,
        offset: p.offset,
        enableMassClear: p.enableMassClear,
        style: p.style,
      }),
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      if (props.visible) ctx.client.driver.overlays.add({ kind: "map", handle: ctx.map }, res);
      scope.add(ctx.client.driver.events.on(res, "click", (e) => emit("click", e)));
      scope.add(ctx.client.driver.events.on(res, "dblclick", (e) => emit("dblclick", e)));
    },
    createWatchers(getCtx, getResource, p, addDisposer) {
      addDisposer(
        watch([() => p.position?.lng, () => p.position?.lat], ([lng, lat], [ol, oa]) => {
          if (lng === undefined || lat === undefined) return;
          if (lng === ol && lat === oa) return;
          const res = getResource();
          const ctx = getCtx();
          if (!res || !ctx) return;
          ctx.client.driver.overlays.setPosition(res, { lng, lat });
        }),
      );
      addDisposer(
        watch(
          () => p.content,
          (c) => {
            const r = getResource();
            const ctx = getCtx();
            if (r && ctx) ctx.client.driver.overlays.setOptions(r, { content: c });
          },
        ),
      );
      addDisposer(
        watch(
          () => p.zIndex,
          (z) => {
            const r = getResource();
            const ctx = getCtx();
            if (z != null && r && ctx) ctx.client.driver.overlays.setOptions(r, { zIndex: z });
          },
        ),
      );
      addDisposer(
        watch(
          () => p.style,
          (s) => {
            const r = getResource();
            const ctx = getCtx();
            if (s && r && ctx) ctx.client.driver.overlays.setOptions(r, { style: s });
          },
        ),
      );
      addDisposer(
        watch(
          () => p.enableMassClear,
          (en) => {
            const r = getResource();
            const ctx = getCtx();
            if (r && ctx) ctx.client.driver.overlays.setOptions(r, { enableMassClear: en });
          },
        ),
      );
      addDisposer(
        watch(
          () => p.visible,
          (visible) => {
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            const overlays = ctx.client.driver.overlays;
            const target = { kind: "map" as const, handle: ctx.map };
            if (visible) overlays.add(target, res);
            else overlays.remove(target, res);
          },
        ),
      );
    },
    remove: (res, ctx) => removeOverlay(res, ctx),
  },
  "label",
);

defineOptions({ name: "BLabel" });
</script>

<template>
  <slot />
</template>
