<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { OverlayHandle } from "../../driver/types/handles";

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

function resolveUrl(url: BGroundOverlayProps["url"]): string | HTMLCanvasElement {
  return typeof url === "function" ? url() : url;
}

function makeBounds(
  start: { lng: number; lat: number },
  end: { lng: number; lat: number },
) {
  return {
    southwest: { lng: start.lng, lat: start.lat },
    northeast: { lng: end.lng, lat: end.lat },
  };
}

const { resource, rebuild } = useOverlayResource<BGroundOverlayProps, OverlayHandle>(
  props,
  {
    create: (ctx, p) => {
      const bounds = makeBounds(p.startPoint, p.endPoint);
      const url = resolveUrl(p.url);
      if (!url) throw new Error("GroundOverlay url is required");
      return ctx.client.driver.overlays.createGroundOverlay(bounds, {
        opacity: p.opacity,
        type: p.type,
        url,
        autoCenter: p.autoCenter,
      });
    },
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      if (props.visible) ctx.client.driver.overlays.add({ kind: "map", handle: ctx.map }, res);
      if (p.autoCenter) {
        ctx.client.driver.map.setViewport(
          ctx.map,
          [p.startPoint, p.endPoint],
          { margins: [20, 20, 20, 20] },
        );
      }
      const on = (name: string, h: (e: unknown) => void) => {
        scope.add(ctx.client.driver.events.on(res, name, h));
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
            ctx.client.driver.overlays.setOptions(res, { bounds: makeBounds(p.startPoint, p.endPoint) });
          },
        ),
      );
      addDisposer(
        watch(
          () => p.opacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { opacity: _v });
            }
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
          (u) => {
            const x = getResource();
            const ctx = getCtx();
            if (x && ctx) ctx.client.driver.overlays.setOptions(x, { url: resolveUrl(u) });
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
  "ground-overlay",
);

defineOptions({ name: "BGroundOverlay" });
</script>

<template>
  <slot />
</template>
