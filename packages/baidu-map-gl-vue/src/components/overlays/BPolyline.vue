<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { PolylineHandle } from "../../driver/types/handles";
import type { BPolylineProps } from "../../types/components";

/**
 * BPolyline 迁移(adapter 模式)
 *
 * path 视为不可变值,更新后替换根引用触发;支持 pathVersion 强制刷新。
 * 大 path 默认不 deep watch。
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

const { resource } = useOverlayResource<BPolylineProps, PolylineHandle>(
  props,
  {
    create: (ctx, p) =>
      ctx.client.driver.overlays.createPolyline(p.path, {
        strokeColor: p.strokeColor,
        strokeWeight: p.strokeWeight,
        strokeOpacity: p.strokeOpacity,
        strokeStyle: p.strokeStyle,
        enableMassClear: p.enableMassClear,
        enableEditing: p.enableEditing,
      }),
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      if (props.visible) ctx.client.driver.overlays.add({ kind: "map", handle: ctx.map }, res);
      scope.add(ctx.client.driver.events.on(res, "click", (e) => emit("click", e)));
      scope.add(ctx.client.driver.events.on(res, "dblclick", (e) => emit("dblclick", e)));
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
          () => p.enableEditing,
          (en) => {
            const r = getResource();
            const ctx = getCtx();
            if (r && ctx) ctx.client.driver.overlays.setOptions(r, { enableEditing: en });
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
  "polyline",
);
</script>

<template>
  <slot />
</template>
