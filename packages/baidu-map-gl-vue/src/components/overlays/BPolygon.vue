<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { toSdkPoints } from "../../core/utils/geometry";

export interface BPolygonProps {
  path: { lng: number; lat: number }[];
  pathVersion?: string | number;
  strokeColor?: string;
  strokeWeight?: number;
  strokeOpacity?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  fillColor?: string;
  fillOpacity?: number;
  enableMassClear?: boolean;
  enableEditing?: boolean;
  visible?: boolean;
}

const props = withDefaults(defineProps<BPolygonProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 0.9,
  strokeStyle: "solid",
  fillColor: "#000000",
  fillOpacity: 0.5,
  enableMassClear: true,
  enableEditing: false,
  visible: true,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
}>();

type SdkPolygon = {
  setPath(p: unknown[]): void;
  setStrokeColor(c: string): void;
  setStrokeWeight(w: number): void;
  setStrokeOpacity(o: number): void;
  setStrokeStyle(s: string): void;
  setFillColor(c: string): void;
  setFillOpacity(o: number): void;
  enableMassClear(): void;
  disableMassClear(): void;
  enableEditing(): void;
  disableEditing(): void;
};

const { resource } = useOverlayResource<BPolygonProps, SdkPolygon>(
  props,
  {
    create: (ctx, p) => {
      const BMapGL = ctx.api as {
        Polygon: new (pts: unknown[], o?: Record<string, unknown>) => unknown;
      };
      return new BMapGL.Polygon(toSdkPoints(ctx.api, p.path), {
        strokeColor: p.strokeColor,
        strokeWeight: p.strokeWeight,
        strokeOpacity: p.strokeOpacity,
        strokeStyle: p.strokeStyle,
        fillColor: p.fillColor,
        fillOpacity: p.fillOpacity,
      }) as unknown as SdkPolygon;
    },
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      const map = ctx.map as { addOverlay: (o: unknown) => void };
      if (props.visible) map.addOverlay(res);
      (ctx as any).overlays?.register?.("polygon", res);
      const on = (name: string, h: (e: unknown) => void) => {
        (res as any).addEventListener?.(name, h);
        scope.add(() => (res as any).removeEventListener?.(name, h));
      };
      on("click", (e) => emit("click", e));
      on("dblclick", (e) => emit("dblclick", e));
    },
    createWatchers(getCtx, getResource, p, addDisposer) {
      addDisposer(
        watch(
          [() => p.path, () => p.pathVersion],
          ([path]) => {
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            if (path && path.length > 0) res.setPath(toSdkPoints(ctx.api, path));
          },
          { flush: "sync" },
        ),
      );
      addDisposer(
        watch(
          () => p.strokeColor,
          (c) => {
            const _v = c;
            if (_v !== undefined) getResource()?.setStrokeColor(_v);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.strokeWeight,
          (w) => {
            const _v = w;
            if (_v !== undefined) getResource()?.setStrokeWeight(_v);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.strokeOpacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) getResource()?.setStrokeOpacity(_v);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.strokeStyle,
          (s) => {
            const _v = s;
            if (_v !== undefined) getResource()?.setStrokeStyle(_v);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.fillColor,
          (c) => {
            const _v = c;
            if (_v !== undefined) getResource()?.setFillColor(_v);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.fillOpacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) getResource()?.setFillOpacity(_v);
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
          () => p.enableEditing,
          (en) => {
            const r = getResource();
            if (r) en ? r.enableEditing() : r.disableEditing();
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
  "polygon",
);

defineOptions({ name: "BPolygon" });
</script>

<template>
  <slot />
</template>
