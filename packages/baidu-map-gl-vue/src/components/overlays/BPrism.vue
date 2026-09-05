<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { toSdkPoints } from "../../core/utils/geometry";

export interface BPrismProps {
  path: { lng: number; lat: number }[];
  altitude: number;
  topFillColor?: string;
  topFillOpacity?: number;
  sideFillColor?: string;
  sideFillOpacity?: number;
  enableMassClear?: boolean;
  visible?: boolean;
}

const props = withDefaults(defineProps<BPrismProps>(), {
  topFillColor: "#fff",
  topFillOpacity: 0.5,
  sideFillColor: "#fff",
  sideFillOpacity: 0.8,
  enableMassClear: true,
  visible: true,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
}>();

type SdkPrism = {
  setPath(p: unknown[]): void;
  setAltitude(a: number): void;
  setTopFillColor(c: string): void;
  setTopFillOpacity(o: number): void;
  setSideFillColor(c: string): void;
  setSideFillOpacity(o: number): void;
  enableMassClear(): void;
  disableMassClear(): void;
};

const { resource } = useOverlayResource<BPrismProps, SdkPrism>(
  props,
  {
    create: (ctx, p) => {
      const BMapGL = ctx.api as {
        Prism: new (pts: unknown[], a: number, o?: Record<string, unknown>) => unknown;
      };
      if (!p.path?.length) throw new Error("BPrism path is required");
      return new BMapGL.Prism(toSdkPoints(ctx.api, p.path), p.altitude, {
        topFillColor: p.topFillColor,
        topFillOpacity: p.topFillOpacity,
        sideFillColor: p.sideFillColor,
        sideFillOpacity: p.sideFillOpacity,
        enableMassClear: p.enableMassClear,
      }) as unknown as SdkPrism;
    },
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      const map = ctx.map as { addOverlay: (o: unknown) => void };
      if (props.visible) map.addOverlay(res);
      (ctx as any).overlays?.register?.("prism", res);
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
          [() => p.path, () => p.altitude],
          () => {
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            if (p.path?.length) res.setPath(toSdkPoints(ctx.api, p.path));
          },
          { flush: "sync" },
        ),
      );
      addDisposer(
        watch(
          () => p.altitude,
          (a) => {
            const _v = a;
            if (_v !== undefined) getResource()?.setAltitude(_v);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.topFillColor,
          (c) => {
            const _v = c;
            if (_v !== undefined) getResource()?.setTopFillColor(_v);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.topFillOpacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) getResource()?.setTopFillOpacity(_v);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.sideFillColor,
          (c) => {
            const _v = c;
            if (_v !== undefined) getResource()?.setSideFillColor(_v);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.sideFillOpacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) getResource()?.setSideFillOpacity(_v);
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
  "prism",
);

defineOptions({ name: "BPrism" });
</script>

<template>
  <slot />
</template>
