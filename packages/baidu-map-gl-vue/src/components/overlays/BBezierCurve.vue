<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { OverlayHandle } from "../../driver/types/handles";

/**
 * BBezierCurve 迁移(adapter 模式)
 *
 * path/controlPoints 视为不可变值,更新后替换根引用触发;支持 pathVersion 强制刷新。
 * 大 path 默认不 deep watch。
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

const { resource } = useOverlayResource<BBezierCurveProps, OverlayHandle>(
  props,
  {
    create: (ctx, p) =>
      ctx.client.driver.overlays.createBezierCurve(p.path, p.controlPoints, {
        strokeColor: p.strokeColor,
        strokeWeight: p.strokeWeight,
        strokeOpacity: p.strokeOpacity,
        strokeStyle: p.strokeStyle,
        enableMassClear: p.enableMassClear,
      }),
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      if (props.visible) ctx.client.driver.overlays.add({ kind: "map", handle: ctx.map }, res);
      const on = (name: string, h: (e: unknown) => void) => {
        scope.add(ctx.client.driver.events.on(res, name, h));
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
            if (path && path.length > 0) ctx.client.driver.overlays.setPath(res, path);
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
            if (cps && cps.length > 0) ctx.client.driver.overlays.setOptions(res, { controlPoints: cps });
          },
          { flush: "sync" },
        ),
      );
      addDisposer(
        watch(
          () => p.strokeColor,
          (c) => {
            const _v = c;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { strokeColor: _v });
            }
          },
        ),
      );
      addDisposer(
        watch(
          () => p.strokeWeight,
          (w) => {
            const _v = w;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { strokeWeight: _v });
            }
          },
        ),
      );
      addDisposer(
        watch(
          () => p.strokeOpacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { strokeOpacity: _v });
            }
          },
        ),
      );
      addDisposer(
        watch(
          () => p.strokeStyle,
          (s) => {
            const _v = s;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { strokeStyle: _v });
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
  "bezier",
);

defineOptions({ name: "BBezierCurve" });
</script>

<template>
  <slot />
</template>
