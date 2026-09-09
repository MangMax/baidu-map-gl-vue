<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { OverlayHandle } from "../../driver/types/handles";

export interface BPrismProps {
  path: { lng: number; lat: number }[] | string[];
  altitude: number;
  topFillColor?: string;
  topFillOpacity?: number;
  sideFillColor?: string;
  sideFillOpacity?: number;
  isBoundary?: boolean;
  autoCenter?: boolean;
  enableMassClear?: boolean;
  visible?: boolean;
}

const props = withDefaults(defineProps<BPrismProps>(), {
  topFillColor: "#fff",
  topFillOpacity: 0.5,
  sideFillColor: "#fff",
  sideFillOpacity: 0.8,
  isBoundary: false,
  autoCenter: true,
  enableMassClear: true,
  visible: true,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
  mouseover: [e: unknown];
  mouseout: [e: unknown];
}>();

const { resource, rebuild } = useOverlayResource<BPrismProps, OverlayHandle>(
  props,
  {
    create: (ctx, p) => {
      if (!p.path?.length) throw new Error("BPrism path is required");
      return ctx.client.driver.overlays.createPrism(p.path, p.altitude, {
        topFillColor: p.topFillColor,
        topFillOpacity: p.topFillOpacity,
        sideFillColor: p.sideFillColor,
        sideFillOpacity: p.sideFillOpacity,
        isBoundary: p.isBoundary,
        autoCenter: p.autoCenter,
        enableMassClear: p.enableMassClear,
      });
    },
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      if (props.visible) ctx.client.driver.overlays.add({ kind: "map", handle: ctx.map }, res);
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
          [() => p.path, () => p.altitude],
          () => {
            const ctx = getCtx();
            if (!p.path?.length || !ctx) return;
            const res = getResource();
            if (res) ctx.client.driver.overlays.setPath(res, p.path);
            else void rebuild();
          },
          { flush: "sync" },
        ),
      );
      addDisposer(
        watch(
          () => p.altitude,
          (a) => {
            const _v = a;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { altitude: _v });
            }
          },
        ),
      );
      addDisposer(
        watch(
          () => p.topFillColor,
          (c) => {
            const _v = c;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { topFillColor: _v });
            }
          },
        ),
      );
      addDisposer(
        watch(
          () => p.topFillOpacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { topFillOpacity: _v });
            }
          },
        ),
      );
      addDisposer(
        watch(
          () => p.sideFillColor,
          (c) => {
            const _v = c;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { sideFillColor: _v });
            }
          },
        ),
      );
      addDisposer(
        watch(
          () => p.sideFillOpacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { sideFillOpacity: _v });
            }
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
  "prism",
);

defineOptions({ name: "BPrism" });
</script>

<template>
  <slot />
</template>
