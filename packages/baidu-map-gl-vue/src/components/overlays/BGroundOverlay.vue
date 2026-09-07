<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";

export type GroundOverlayType = "video" | "canvas" | "image";

export interface BGroundOverlayProps {
  type: GroundOverlayType;
  url: string | HTMLCanvasElement | (() => string | HTMLCanvasElement);
  startPoint: { lng: number; lat: number };
  endPoint: { lng: number; lat: number };
  opacity?: number;
  autoCenter?: boolean;
  visible?: boolean;
}

const props = withDefaults(defineProps<BGroundOverlayProps>(), {
  opacity: 1,
  autoCenter: true,
  visible: true,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
  mouseover: [e: unknown];
  mouseout: [e: unknown];
}>();

type SdkGroundOverlay = {
  setOpacity(o: number): void;
  setBounds(b: unknown): void;
  setUrl(u: unknown): void;
};

function resolveUrl(url: BGroundOverlayProps["url"]): string | HTMLCanvasElement {
  return typeof url === "function" ? url() : url;
}

function makeBounds(
  api: unknown,
  start: { lng: number; lat: number },
  end: { lng: number; lat: number },
) {
  const BMapGL = api as {
    Point: new (l: number, t: number) => unknown;
    Bounds: new (sw: unknown, ne: unknown) => unknown;
  };
  return new BMapGL.Bounds(
    new BMapGL.Point(start.lng, start.lat),
    new BMapGL.Point(end.lng, end.lat),
  );
}

const { resource, rebuild } = useOverlayResource<BGroundOverlayProps, SdkGroundOverlay>(
  props,
  {
    create: (ctx, p) => {
      const BMapGL = ctx.api as {
        GroundOverlay: new (b: unknown, o?: Record<string, unknown>) => unknown;
      };
      const bounds = makeBounds(ctx.api, p.startPoint, p.endPoint);
      const url = resolveUrl(p.url);
      if (!url) throw new Error("GroundOverlay url is required");
      return new BMapGL.GroundOverlay(bounds, {
        opacity: p.opacity,
         type: p.type,
         url,
         autoCenter: p.autoCenter,
      }) as unknown as SdkGroundOverlay;
    },
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      const map = ctx.map as {
        addOverlay: (o: unknown) => void;
        centerAndZoom?: (center: unknown, zoom: number) => void;
        getViewport?: (points: unknown[]) => unknown;
        setViewport?: (viewport: unknown, options?: unknown) => void;
      };
      if (props.visible) map.addOverlay(res);
      if (p.autoCenter && map.getViewport && map.setViewport) {
        const Point = (ctx.api as { Point: new (lng: number, lat: number) => unknown }).Point;
        const viewport = map.getViewport([
          new Point(p.startPoint.lng, p.startPoint.lat),
          new Point(p.endPoint.lng, p.endPoint.lat),
        ]);
        if (viewport) map.setViewport(viewport, { margins: [20, 20, 20, 20] });
      } else if (p.autoCenter && map.centerAndZoom) {
        const center = (makeBounds(ctx.api, p.startPoint, p.endPoint) as { getCenter?: () => unknown }).getCenter?.();
        if (center) map.centerAndZoom(center, 16);
      }
      (ctx as any).overlays?.register?.("ground-overlay", res);
      const on = (name: string, h: (e: unknown) => void) => {
        (res as any).addEventListener?.(name, h);
        scope.add(() => (res as any).removeEventListener?.(name, h));
      };
      on("click", (e) => emit("click", e));
      on("dblclick", (e) => emit("dblclick", e));
      on("mouseover", (e) => emit("mouseover", e));
      on("mouseout", (e) => emit("mouseout", e));
    },
    createWatchers(getCtx, getResource, p, addDisposer) {
      addDisposer(
        watch(
          [
            () => p.startPoint.lng,
            () => p.startPoint.lat,
            () => p.endPoint.lng,
            () => p.endPoint.lat,
          ],
          () => {
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            res.setBounds(makeBounds(ctx.api, p.startPoint, p.endPoint));
          },
        ),
      );
      addDisposer(
        watch(
          () => p.opacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) getResource()?.setOpacity(_v);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.type,
          () => {
            void rebuild();
          },
        ),
      );
      addDisposer(
        watch(
          () => p.url,
          (u) => getResource()?.setUrl(resolveUrl(u)),
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
  "ground-overlay",
);

defineOptions({ name: "BGroundOverlay" });
</script>

<template>
  <slot />
</template>
