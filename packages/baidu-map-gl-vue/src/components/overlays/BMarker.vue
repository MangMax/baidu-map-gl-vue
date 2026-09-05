<script setup lang="ts">
import { provide, watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import { overlayContextKey } from "../../core/context/types";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { BMarkerProps } from "../../types/components";

export type { BMarkerProps };

const props = withDefaults(defineProps<BMarkerProps>(), {
  offset: () => ({ x: 0, y: 0 }),
  visible: true,
  title: "",
});

const emit = defineEmits<{
  click: [e: unknown];
  dragend: [e: unknown];
  dblclick: [e: unknown];
}>();

type SdkMarker = {
  setPosition(p: unknown): void;
  setOffset(o: unknown): void;
  setZIndex(z: number): void;
  setRotation(r: number): void;
  enableDragging(): void;
  disableDragging(): void;
  setTitle(t: string): void;
};

const make = (api: unknown, position: { lng: number; lat: number }, p: BMarkerProps) => {
  const BMapGL = api as {
    Point: new (lng: number, lat: number) => unknown;
    Marker: new (point: unknown, opts?: Record<string, unknown>) => unknown;
    Size: new (w: number, h: number) => unknown;
  };
  return new BMapGL.Marker(new BMapGL.Point(position.lng, position.lat), {
    offset: new BMapGL.Size((p.offset ?? { x: 0, y: 0 }).x, (p.offset ?? { x: 0, y: 0 }).y),
    title: p.title,
  }) as unknown as SdkMarker;
};

const { resource } = useOverlayResource<BMarkerProps, SdkMarker>(
  props,
  {
    create: (ready, p) => make(ready.api, p.position, p),
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      (ctx.map as { addOverlay: (o: unknown) => void }).addOverlay(res);
      (ctx as any).overlays?.register?.("marker", res);
      // SDK 事件绑定(ready 后,res 可用),注册到 scope,卸载时释放
      bindMarkerEvents(ctx, res, scope);
    },
    // 响应式 prop watcher:setup 阶段同步注册(保证响应式)
    createWatchers(getCtx, getResource, p, addDisposer) {
      addDisposer(
        watch([() => p.position.lng, () => p.position.lat], ([lng, lat], [oldLng, oldLat]) => {
          if (lng === oldLng && lat === oldLat) return;
          const res = getResource();
          const ctx = getCtx();
          if (!res || !ctx) return;
          const Point = (ctx.api as { Point: new (l: number, t: number) => unknown }).Point;
          res.setPosition(new Point(lng, lat));
        }),
      );
      addDisposer(
        watch(
          [() => (p.offset ?? { x: 0, y: 0 }).x, () => (p.offset ?? { x: 0, y: 0 }).y],
          ([x, y], [ox, oy]) => {
            if (x === ox && y === oy) return;
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            const Size = (ctx.api as { Size: new (a: number, b: number) => unknown }).Size;
            res.setOffset(new Size(x, y));
          },
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
          () => p.title,
          (t) => {
            const r = getResource();
            if (t != null && r) r.setTitle(t);
          },
        ),
      );
      // visible 幂等切换(§11.2)
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
      addDisposer(
        watch(
          () => p.enableDragging,
          (en) => {
            const r = getResource();
            if (r) en ? r.enableDragging() : r.disableDragging();
          },
        ),
      );
    },
    remove: (res, ctx) => removeOverlay(res, ctx),
  },
  "marker",
);

// SDK 事件绑定:ready 后(res 可用)调用,全部注册到 scope
function bindMarkerEvents(ctx: MapReadyContext, res: SdkMarker, scope: ResourceScope) {
  const on = (name: string, h: (e: unknown) => void) => {
    (res as any).addEventListener?.(name, h);
    scope.add(() => (res as any).removeEventListener?.(name, h));
  };
  on("click", (e) => emit("click", e));
  on("dragend", (e) => emit("dragend", e));
  on("dblclick", (e) => emit("dblclick", e));
}

// provide 必须在 setup 中调用
provide(overlayContextKey, () => resource.value);
</script>

<template>
  <slot />
</template>
