<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { BCircleProps } from "../../types/components";

/**
 * M4-07: BCircle 迁移(adapter 模式,center/radius 字段级更新,无 deep watch)
 */
export type { BCircleProps };

const props = withDefaults(defineProps<BCircleProps>(), {
  strokeColor: "#000000",
  strokeOpacity: 0.9,
  fillColor: "#000000",
  fillOpacity: 0.5,
  strokeWeight: 2,
  strokeStyle: "solid",
  enableMassClear: true,
  enableEditing: false,
  enableClicking: true,
  visible: true,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
}>();

type SdkCircle = {
  setCenter(p: unknown): void;
  setRadius(r: number): void;
  setStrokeColor(c: string): void;
  setFillColor(c: string): void;
  setStrokeOpacity(o: number): void;
  setFillOpacity(o: number): void;
  setStrokeWeight(w: number): void;
  setStrokeStyle(s: string): void;
  enableMassClear(): void;
  disableMassClear(): void;
  enableEditing(): void;
  disableEditing(): void;
};

const { resource } = useOverlayResource<BCircleProps, SdkCircle>(
  props,
  {
    create: (ctx, p) => {
      const BMapGL = ctx.api as {
        Circle: new (c: unknown, r: number, o?: Record<string, unknown>) => unknown;
        Point: new (l: number, t: number) => unknown;
      };
      const point = new BMapGL.Point(p.center.lng, p.center.lat);
      return new BMapGL.Circle(point, p.radius, {
        strokeColor: p.strokeColor,
        strokeWeight: p.strokeWeight,
        strokeOpacity: p.strokeOpacity,
        strokeStyle: p.strokeStyle,
        fillOpacity: p.fillOpacity,
        fillColor: p.fillColor,
      }) as unknown as SdkCircle;
    },
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      const map = ctx.map as { addOverlay: (o: unknown) => void };
      if (props.visible) map.addOverlay(res);
      (ctx as any).overlays?.register?.("circle", res);
      bindSdkEvents(res as any, ctx, scope);
    },
    createWatchers(getCtx, getResource, p, addDisposer) {
      addDisposer(
        watch([() => p.center.lng, () => p.center.lat], ([lng, lat], [ol, oa]) => {
          if (lng === ol && lat === oa) return;
          const res = getResource();
          const ctx = getCtx();
          if (!res || !ctx) return;
          const Point = (ctx.api as { Point: new (l: number, t: number) => unknown }).Point;
          res.setCenter(new Point(lng, lat));
        }),
      );
      addDisposer(
        watch(
          () => p.radius,
          (r) => {
            const x = getResource();
            if (x) x.setRadius(r);
          },
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
          () => p.fillColor,
          (c) => {
            const _v = c;
            if (_v !== undefined) getResource()?.setFillColor(_v);
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
          () => p.fillOpacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) getResource()?.setFillOpacity(_v);
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
  "circle",
);

// SDK 事件绑定(ready 后),注册到 scope
function bindSdkEvents(res: any, ctx: MapReadyContext, scope: ResourceScope) {
  const on = (name: string, h: (e: unknown) => void) => {
    res.addEventListener?.(name, h);
    scope.add(() => res.removeEventListener?.(name, h));
  };
  on("click", (e) => emit("click", e));
  on("dblclick", (e) => emit("dblclick", e));
}
</script>

<template>
  <slot />
</template>
