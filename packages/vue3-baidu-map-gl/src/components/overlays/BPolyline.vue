<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { BPolylineProps } from "../../types/components";

/**
 * M4-07: BPolyline 迁移(adapter 模式)
 *
 * path 视为不可变值,更新后替换根引用触发;支持 pathVersion 强制刷新。
 * 大 path 默认不 deep watch(§11.5)。
 */
export type { BPolylineProps };

const props = withDefaults(defineProps<BPolylineProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 0.9,
  strokeStyle: "solid",
  enableMassClear: true,
  enableEditing: false,
  visible: true,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
}>();

type SdkPolyline = {
  setPath(p: unknown[]): void;
  setStrokeColor(c: string): void;
  setStrokeWeight(w: number): void;
  setStrokeOpacity(o: number): void;
  setStrokeStyle(s: string): void;
  enableMassClear(): void;
  disableMassClear(): void;
  enableEditing(): void;
  disableEditing(): void;
};

function toPoints(api: unknown, path: { lng: number; lat: number }[]): unknown[] {
  const Point = (api as { Point: new (l: number, t: number) => unknown }).Point;
  return path.map(({ lng, lat }) => new Point(lng, lat));
}

const { resource } = useOverlayResource<BPolylineProps, SdkPolyline>(
  props,
  {
    create: (ctx, p) => {
      const BMapGL = ctx.api as {
        Polyline: new (pts: unknown[], o?: Record<string, unknown>) => unknown;
      };
      return new BMapGL.Polyline(toPoints(ctx.api, p.path), {
        strokeColor: p.strokeColor,
        strokeWeight: p.strokeWeight,
        strokeOpacity: p.strokeOpacity,
        strokeStyle: p.strokeStyle,
      }) as unknown as SdkPolyline;
    },
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      const map = ctx.map as { addOverlay: (o: unknown) => void };
      if (props.visible) map.addOverlay(res);
      (ctx as any).overlays?.register?.("polyline", res);
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
            if (path && path.length > 0) res.setPath(toPoints(ctx.api, path));
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
  "polyline",
);
</script>

<template>
  <slot />
</template>
