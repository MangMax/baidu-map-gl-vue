<script setup lang="ts">
import { provide, watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import { overlayContextKey } from "../../core/context/types";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { MarkerHandle } from "../../driver/types/handles";
import type { BMarkerProps, MarkerIcon } from "../../types/components";

export type { BMarkerProps };

const props = withDefaults(defineProps<BMarkerProps>(), {
  offset: () => ({ x: 0, y: 0 }),
  visible: true,
  title: "",
  enableClicking: true,
  enableDragging: false,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
  rightclick: [e: unknown];
  mousedown: [e: unknown];
  mouseup: [e: unknown];
  mouseover: [e: unknown];
  mouseout: [e: unknown];
  dragstart: [e: unknown];
  dragging: [e: unknown];
  dragend: [e: unknown];
  "drag-end": [e: unknown];
  remove: [e: unknown];
  "update:position": [position: { lng: number; lat: number }];
}>();

// 创建时应用全部构造属性（offset/title/icon/enableClicking/rotation/draggable）
const make = (ctx: MapReadyContext, position: { lng: number; lat: number }, p: BMarkerProps) =>
  ctx.client.driver.overlays.createMarker(position, {
    offset: p.offset,
    title: p.title,
    enableClicking: p.enableClicking,
    enableDragging: p.enableDragging,
    rotation: p.rotation,
    zIndex: p.zIndex,
    icon: p.icon,
  });

function setVisible(
  ctx: MapReadyContext,
  res: MarkerHandle,
  visible: boolean | undefined,
) {
  const driver = ctx.client.driver.overlays;
  if (visible === false) {
    // 优先 show/hide（不破坏 overlay 归属），否则 add/remove
    if (!driver.hide(res)) driver.remove({ kind: "map", handle: ctx.map }, res);
  } else {
    if (!driver.show(res)) driver.add({ kind: "map", handle: ctx.map }, res);
  }
}

const { resource, rebuild } = useOverlayResource<BMarkerProps, MarkerHandle>(
  props,
  {
    create: (ready, p) => make(ready, p.position, p),
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      // visible 初始行为——visible=false 时不 add，避免先 add 再等 watcher
      if (p.visible !== false) {
        ctx.client.driver.overlays.add({ kind: "map", handle: ctx.map }, res);
      }
      // Registry 统一由 useOverlayResource 上下文管理，此处只做地图添加。
      // SDK 事件绑定(ready 后,res 可用),注册到 scope,卸载时释放
      bindMarkerEvents(ctx, res, scope);
    },
    // 响应式 prop watcher:setup 阶段同步注册(保证响应式)
    createWatchers(getCtx, getResource, p, addDisposer) {
      addDisposer(
        watch(
          [() => p.position?.lng, () => p.position?.lat],
          ([lng, lat], [oldLng, oldLat]) => {
            if (lng === undefined || lat === undefined) return;
            if (lng === oldLng && lat === oldLat) return;
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            ctx.client.driver.overlays.setPosition(res, { lng, lat });
          },
        ),
      );
      addDisposer(
        watch(
          [() => (p.offset ?? { x: 0, y: 0 }).x, () => (p.offset ?? { x: 0, y: 0 }).y],
          ([x, y], [ox, oy]) => {
            if (x === ox && y === oy) return;
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            ctx.client.driver.overlays.setOptions(res, { offset: { x, y } });
          },
        ),
      );
      addDisposer(
        watch(
          () => p.zIndex,
          (z) => {
            const r = getResource();
            const ctx = getCtx();
            if (z != null && r && ctx) ctx.client.driver.overlays.setOptions(r, { zIndex: z });
          },
        ),
      );
      addDisposer(
        watch(
          () => p.rotation,
          (r) => {
            const res = getResource();
            const ctx = getCtx();
            if (r != null && res && ctx) ctx.client.driver.overlays.setOptions(res, { rotation: r });
          },
        ),
      );
      addDisposer(
        watch(
          () => p.title,
          (t) => {
            const r = getResource();
            const ctx = getCtx();
            if (t != null && r && ctx) ctx.client.driver.overlays.setOptions(r, { title: t });
          },
        ),
      );
      // icon: SDK 支持 setter 则 setter，否则重建（避免行为不一致）
      addDisposer(
        watch(
          () => p.icon,
          (icon) => {
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            const raw = res.raw as { setIcon?: (icon: unknown) => void };
            if (typeof raw.setIcon === "function") {
              const built = ctx.client.driver.overlays.buildIcon(icon as MarkerIcon);
              if (built) ctx.client.driver.overlays.setOptions(res, { icon });
              else void rebuild();
            } else {
              void rebuild();
            }
          },
          { deep: true },
        ),
      );
      // visible 幂等切换
      addDisposer(
        watch(
          () => p.visible,
          (visible) => {
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            setVisible(ctx, res, visible);
          },
        ),
      );
      // draggable: enable/disable 切换
      addDisposer(
        watch(
          () => p.enableDragging,
          (en) => {
            const r = getResource();
            const ctx = getCtx();
            if (r && ctx) ctx.client.driver.overlays.setOptions(r, { enableDragging: en });
          },
        ),
      );
      // enableClicking 构造期：变化重建
      addDisposer(
        watch(
          () => p.enableClicking,
          (v, old) => {
            if (v === old) return;
            void rebuild();
          },
        ),
      );
    },
    remove: (res, ctx) => removeOverlay(res, ctx),
  },
  "marker",
);

type DragEndEvent = { position?: { lng: number; lat: number }; point?: { lng: number; lat: number } };

// SDK 事件绑定:ready 后(res 可用)调用,全部注册到 scope
function bindMarkerEvents(ctx: MapReadyContext, res: MarkerHandle, scope: ResourceScope) {
  const on = (name: string, h: (e: unknown) => void) => {
    scope.add(ctx.client.driver.events.on(res, name, h));
  };
  on("click", (e) => emit("click", e));
  on("dblclick", (e) => emit("dblclick", e));
  on("rightclick", (e) => emit("rightclick", e));
  on("mousedown", (e) => emit("mousedown", e));
  on("mouseup", (e) => emit("mouseup", e));
  on("mouseover", (e) => emit("mouseover", e));
  on("mouseout", (e) => emit("mouseout", e));
  on("dragstart", (e) => emit("dragstart", e));
  on("dragging", (e) => emit("dragging", e));
  on("dragend", (e) => {
    emit("dragend", e);
    emit("drag-end", e);
    // 拖拽结束回写位置
    const evt = e as DragEndEvent;
    const position = evt.position ?? evt.point;
    if (position && typeof position.lng === "number" && typeof position.lat === "number") {
      emit("update:position", { lng: position.lng, lat: position.lat });
    }
  });
  on("remove", (e) => emit("remove", e));
}

// provide 必须在 setup 中调用
provide(overlayContextKey, () => resource.value);
</script>

<template>
  <slot />
</template>
