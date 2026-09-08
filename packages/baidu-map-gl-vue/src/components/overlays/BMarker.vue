<script setup lang="ts">
import { provide, watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import { overlayContextKey } from "../../core/context/types";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { BMarkerProps, MarkerIcon, MarkerCustomIcon } from "../../types/components";

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

type SdkMarker = {
  setPosition(p: unknown): void;
  setOffset(o: unknown): void;
  setZIndex(z: number): void;
  setRotation(r: number): void;
  setTitle(t: string): void;
  setIcon?(icon: unknown): void;
  enableDragging(): void;
  disableDragging(): void;
  show?(): void;
  hide?(): void;
};

// 内置图标雪碧图(loc_red 等)
const DEFAULT_ICON_URL = "https://mapopen.bj.bcebos.com/cms/react-bmap/markers_new2x_fbb9e99.png";
const ICON_OFFSETS: Record<string, [number, number, number, number]> = {
  simple_red: [454, 378, 42, 66],
  simple_blue: [454, 450, 42, 66],
  loc_red: [400, 378, 46, 70],
  loc_blue: [400, 450, 46, 70],
  start: [298, 450, 46, 70],
  end: [298, 378, 46, 70],
  location: [400, 378, 46, 70],
};

const SPECIAL_ICON_URLS: Record<string, string> = {
  start: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='32'%3E%3Cpath fill='%231677ff' stroke='white' stroke-width='2' d='M12 1C6 1 2 5 2 11c0 8 10 19 10 19s10-11 10-19C22 5 18 1 12 1z'/%3E%3Ccircle fill='white' cx='12' cy='11' r='4'/%3E%3C/svg%3E",
  end: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='32'%3E%3Cpath fill='%23f04444' stroke='white' stroke-width='2' d='M12 1C6 1 2 5 2 11c0 8 10 19 10 19s10-11 10-19C22 5 18 1 12 1z'/%3E%3Ccircle fill='white' cx='12' cy='11' r='4'/%3E%3C/svg%3E",
};

function buildIcon(api: unknown, icon: MarkerIcon | undefined): unknown | undefined {
  if (!icon) return undefined;
  const BMapGL = api as {
    Icon: new (url: string, size: unknown, opts?: Record<string, unknown>) => unknown;
    Size: new (w: number, h: number) => unknown;
  };
  // 字符串内置名
  if (typeof icon === "string") {
    if (SPECIAL_ICON_URLS[icon]) {
      return new BMapGL.Icon(SPECIAL_ICON_URLS[icon], new BMapGL.Size(24, 32), {
        // Keep the pin tip aligned with the coordinate while the legacy
        // examples retain their y=-16 offset.
        anchor: new BMapGL.Size(12, 16),
      });
    }
    const [ox, oy, w, h] = ICON_OFFSETS[icon] ?? [454, 378, 42, 66];
    return new BMapGL.Icon(DEFAULT_ICON_URL, new BMapGL.Size(w / 2, h / 2), {
      imageOffset: new BMapGL.Size(ox / 2, oy / 2),
      imageSize: new BMapGL.Size(600 / 2, 600 / 2),
    });
  }
  // 自定义对象
  const c = icon as MarkerCustomIcon;
  const opts: Record<string, unknown> = {
    size: new BMapGL.Size(c.size.width, c.size.height),
  };
  if (c.imageSize) opts.imageSize = new BMapGL.Size(c.imageSize.width, c.imageSize.height);
  if (c.anchor) opts.anchor = new BMapGL.Size(c.anchor.x, c.anchor.y);
  if (c.imageOffset) opts.imageOffset = new BMapGL.Size(c.imageOffset.x, c.imageOffset.y);
  if (c.printImageUrl) opts.printImageUrl = c.printImageUrl;
  return new BMapGL.Icon(c.imageUrl, new BMapGL.Size(c.size.width, c.size.height), opts);
}

// P0-13: 创建时应用全部构造属性（offset/title/icon/enableClicking/rotation/draggable）
const make = (api: unknown, position: { lng: number; lat: number }, p: BMarkerProps) => {
  const BMapGL = api as {
    Point: new (lng: number, lat: number) => unknown;
    Marker: new (point: unknown, opts?: Record<string, unknown>) => unknown;
    Size: new (w: number, h: number) => unknown;
  };
  const opts: Record<string, unknown> = {
    offset: new BMapGL.Size((p.offset ?? { x: 0, y: 0 }).x, (p.offset ?? { x: 0, y: 0 }).y),
    title: p.title,
    enableClicking: p.enableClicking,
    enableDragging: p.enableDragging,
  };
  if (p.rotation != null) opts.rotation = p.rotation;
  const icon = buildIcon(api, p.icon);
  if (icon) opts.icon = icon;
  const marker = new BMapGL.Marker(
    new BMapGL.Point(position.lng, position.lat),
    opts,
  ) as unknown as SdkMarker;
  // 部分 SDK 构造期忽略 rotation/dragging，创建后显式同步一次，保证与更新行为一致
  if (p.rotation != null) {
    try {
      marker.setRotation(p.rotation);
    } catch {
      /* 忽略不支持的 setter */
    }
  }
  if (p.zIndex != null) {
    try {
      marker.setZIndex(p.zIndex);
    } catch {
      /* 忽略不支持的 setter */
    }
  }
  if (p.enableDragging) {
    try {
      marker.enableDragging();
    } catch {
      /* 忽略 */
    }
  }
  return marker;
};

function setVisible(
  ctx: MapReadyContext,
  res: SdkMarker,
  visible: boolean | undefined,
) {
  const map = ctx.map as {
    addOverlay: (o: unknown) => void;
    removeOverlay: (o: unknown) => void;
  };
  if (visible === false) {
    // 优先 show/hide（不破坏 overlay 归属），否则 add/remove
    const withVis = res as SdkMarker & { show?: () => void; hide?: () => void };
    if (withVis.hide && withVis.show) withVis.hide();
    else map.removeOverlay(res);
  } else {
    const withVis = res as SdkMarker & { show?: () => void; hide?: () => void };
    if (withVis.hide && withVis.show) withVis.show();
    else map.addOverlay(res);
  }
}

const { resource, rebuild } = useOverlayResource<BMarkerProps, SdkMarker>(
  props,
  {
    create: (ready, p) => make(ready.api, p.position, p),
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      // P0-13: visible 初始行为——visible=false 时不 add，避免先 add 再等 watcher
      if (p.visible !== false) {
        (ctx.map as { addOverlay: (o: unknown) => void }).addOverlay(res);
      }
      // P0-13 §6.5: 删除错误的 `(ctx as any).overlays` 注册；
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
            const Point = (ctx.api as { Point: new (l: number, t: number) => unknown }).Point;
            res.setPosition(new Point(lng, lat));
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
          () => p.rotation,
          (r) => {
            const res = getResource();
            if (r != null && res) res.setRotation(r);
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
      // icon: SDK 支持 setter 则 setter，否则重建（避免行为不一致）
      addDisposer(
        watch(
          () => p.icon,
          (icon) => {
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            if (typeof (res as SdkMarker).setIcon === "function") {
              const built = buildIcon(ctx.api, icon);
              if (built) (res as SdkMarker).setIcon!(built);
              else void rebuild();
            } else {
              void rebuild();
            }
          },
          { deep: true },
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
            if (r) en ? r.enableDragging() : r.disableDragging();
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
function bindMarkerEvents(ctx: MapReadyContext, res: SdkMarker, scope: ResourceScope) {
  const on = (name: string, h: (e: unknown) => void) => {
    (res as any).addEventListener?.(name, h);
    scope.add(() => (res as any).removeEventListener?.(name, h));
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
