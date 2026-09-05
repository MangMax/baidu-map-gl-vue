<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { toSdkPoints } from "../../core/utils/geometry";

/**
 * M4-08: BBezierCurve 迁移(adapter 模式)
 *
 * path/controlPoints 视为不可变值,更新后替换根引用触发;支持 pathVersion 强制刷新。
 * 大 path 默认不 deep watch(§11.5)。
 */
export interface BBezierCurveProps {
  path: { lng: number; lat: number }[];
  controlPoints: { lng: number; lat: number }[][];
  pathVersion?: string | number;
  controlPointsVersion?: string | number;
  strokeColor?: string;
  strokeWeight?: number;
  strokeOpacity?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  enableMassClear?: boolean;
  visible?: boolean;
}

const props = withDefaults(defineProps<BBezierCurveProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 1,
  strokeStyle: "solid",
  enableMassClear: true,
  visible: true,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
  mousedown: [e: unknown];
  mouseup: [e: unknown];
  mouseout: [e: unknown];
  mouseover: [e: unknown];
  remove: [e: unknown];
  lineupdate: [e: unknown];
}>();

type SdkBezierCurve = {
  setPath(p: unknown[]): void;
  setControlPoints(points: unknown[][]): void;
  setStrokeColor(c: string): void;
  setStrokeWeight(w: number): void;
  setStrokeOpacity(o: number): void;
  setStrokeStyle(s: string): void;
  enableMassClear(): void;
  disableMassClear(): void;
};

const { resource } = useOverlayResource<BBezierCurveProps, SdkBezierCurve>(
  props,
  {
    create: (ctx, p) => {
      const BMapGL = ctx.api as {
        BezierCurve: new (pts: unknown[], cp: unknown[][], o?: Record<string, unknown>) => unknown;
      };
      return new BMapGL.BezierCurve(
        toSdkPoints(ctx.api, p.path),
        p.controlPoints.map((c) => toSdkPoints(ctx.api, c)),
        {
          strokeColor: p.strokeColor,
          strokeWeight: p.strokeWeight,
          strokeOpacity: p.strokeOpacity,
          strokeStyle: p.strokeStyle,
          enableMassClear: p.enableMassClear,
        },
      ) as unknown as SdkBezierCurve;
    },
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      const map = ctx.map as { addOverlay: (o: unknown) => void };
      if (props.visible) map.addOverlay(res);
      (ctx as any).overlays?.register?.("bezier", res);
      const on = (name: string, h: (e: unknown) => void) => {
        (res as any).addEventListener?.(name, h);
        scope.add(() => (res as any).removeEventListener?.(name, h));
      };
      on("click", (e) => emit("click", e));
      on("dblclick", (e) => emit("dblclick", e));
      on("mousedown", (e) => emit("mousedown", e));
      on("mouseup", (e) => emit("mouseup", e));
      on("mouseout", (e) => emit("mouseout", e));
      on("mouseover", (e) => emit("mouseover", e));
      on("remove", (e) => emit("remove", e));
      on("lineupdate", (e) => emit("lineupdate", e));
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
          [() => p.controlPoints, () => p.controlPointsVersion],
          ([cps]) => {
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            if (cps && cps.length > 0) res.setControlPoints(cps.map((c) => toSdkPoints(ctx.api, c)));
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
  "bezier",
);

defineOptions({ name: "BBezierCurve" });
</script>

<template>
  <slot />
</template>
