<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";

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

type SdkLabel = {
  setContent(c: string): void;
  setPosition(p: unknown): void;
  setOffset(o: unknown): void;
  setZIndex(z: number): void;
  setStyle(s: Record<string, unknown>): void;
  enableMassClear(): void;
  disableMassClear(): void;
};

const { resource } = useOverlayResource<BLabelProps, SdkLabel>(
  props,
  {
    create: (ctx, p) => {
      const BMapGL = ctx.api as {
        Label: new (content: string, o?: Record<string, unknown>) => unknown;
        Point: new (l: number, t: number) => unknown;
        Size: new (a: number, b: number) => unknown;
      };
      const label = new BMapGL.Label(p.content, {
        position: new BMapGL.Point(p.position.lng, p.position.lat),
        offset: new BMapGL.Size((p.offset ?? { x: 0, y: 0 }).x, (p.offset ?? { x: 0, y: 0 }).y),
        enableMassClear: p.enableMassClear,
      }) as unknown as SdkLabel;
      if (p.style) label.setStyle(p.style);
      return label;
    },
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      const map = ctx.map as { addOverlay: (o: unknown) => void };
      if (props.visible) map.addOverlay(res);
      (ctx as any).overlays?.register?.("label", res);
      const on = (name: string, h: (e: unknown) => void) => {
        (res as any).addEventListener?.(name, h);
        scope.add(() => (res as any).removeEventListener?.(name, h));
      };
      on("click", (e) => emit("click", e));
      on("dblclick", (e) => emit("dblclick", e));
    },
    createWatchers(getCtx, getResource, p, addDisposer) {
      addDisposer(
        watch([() => p.position?.lng, () => p.position?.lat], ([lng, lat], [ol, oa]) => {
          if (lng === undefined || lat === undefined) return;
          if (lng === ol && lat === oa) return;
          const res = getResource();
          const ctx = getCtx();
          if (!res || !ctx) return;
          const Point = (ctx.api as { Point: new (l: number, t: number) => unknown }).Point;
          res.setPosition(new Point(lng, lat));
        }),
      );
      addDisposer(
        watch(
          () => p.content,
          (c) => getResource()?.setContent(c),
        ),
      );
      addDisposer(
        watch(
          () => p.zIndex,
          (z) => {
            const r = getResource();
            if (z != null && r) r.setZIndex(z);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.style,
          (s) => {
            const r = getResource();
            if (s && r) r.setStyle(s);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.enableMassClear,
          (en) => {
            const r = getResource();
            if (r) en ? r.enableMassClear() : r.disableMassClear();
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
            const map = ctx.map as {
              addOverlay: (o: unknown) => void;
              removeOverlay: (o: unknown) => void;
            };
            if (visible) map.addOverlay(res);
            else map.removeOverlay(res);
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
