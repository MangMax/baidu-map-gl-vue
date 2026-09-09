<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { CircleHandle } from "../../driver/types/handles";
import type { BCircleProps } from "../../types/components";

/**
 * BCircle 迁移(adapter 模式,center/radius 字段级更新,无 deep watch)
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

const { resource } = useOverlayResource<BCircleProps, CircleHandle>(
  props,
  {
    create: (ctx, p) =>
      ctx.client.driver.overlays.createCircle(p.center, p.radius, {
        strokeColor: p.strokeColor,
        strokeWeight: p.strokeWeight,
        strokeOpacity: p.strokeOpacity,
        strokeStyle: p.strokeStyle,
        fillOpacity: p.fillOpacity,
        fillColor: p.fillColor,
        enableMassClear: p.enableMassClear,
        enableEditing: p.enableEditing,
        enableClicking: p.enableClicking,
      }),
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      if (props.visible) ctx.client.driver.overlays.add({ kind: "map", handle: ctx.map }, res);
      bindSdkEvents(ctx, res, scope);
    },
    createWatchers(getCtx, getResource, p, addDisposer) {
      addDisposer(
        watch([() => p.center?.lng, () => p.center?.lat], ([lng, lat], [ol, oa]) => {
          if (lng === undefined || lat === undefined) return;
          if (lng === ol && lat === oa) return;
          const res = getResource();
          const ctx = getCtx();
          if (!res || !ctx) return;
          ctx.client.driver.overlays.setPosition(res, { lng, lat });
        }),
      );
      addDisposer(
        watch(
          () => p.radius,
          (r) => {
            const x = getResource();
            const ctx = getCtx();
            if (x && ctx) ctx.client.driver.overlays.setOptions(x, { radius: r });
          },
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
          () => p.fillColor,
          (c) => {
            const _v = c;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { fillColor: _v });
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
          () => p.fillOpacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { fillOpacity: _v });
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
  "circle",
);

// SDK 事件绑定(ready 后),注册到 scope
function bindSdkEvents(ctx: MapReadyContext, res: CircleHandle, scope: ResourceScope) {
  scope.add(ctx.client.driver.events.on(res, "click", (e) => emit("click", e)));
  scope.add(ctx.client.driver.events.on(res, "dblclick", (e) => emit("dblclick", e)));
}
</script>

<template>
  <slot />
</template>
