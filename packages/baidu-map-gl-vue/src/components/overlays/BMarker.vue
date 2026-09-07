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
});

const emit = defineEmits<{
  click: [e: unknown];
  dragend: [e: unknown];
  dblclick: [e: unknown];
}>();

type SdkMarker = {
  setPosition(p: unknown): void;
  setOffset(o: unknown): void;
  setZIndex(z: number): void;
  setRotation(r: number): void;
  enableDragging(): void;
  disableDragging(): void;
  setTitle(t: string): void;
};

// 内置图标雪碧图(loc_red 等)
const DEFAULT_ICON_URL = "//mapopen.bj.bcebos.com/cms/react-bmap/markers_new2x_fbb9e99.png";
const ICON_OFFSETS: Record<string, [number, number, number, number]> = {
  simple_red: [454, 378, 42, 66],
  simple_blue: [454, 450, 42, 66],
  loc_red: [400, 378, 46, 70],
  loc_blue: [400, 450, 46, 70],
  start: [298, 450, 46, 70],
  end: [298, 378, 46, 70],
  location: [400, 378, 46, 70],
};

function buildIcon(api: unknown, icon: MarkerIcon | undefined): unknown | undefined {
  if (!icon) return undefined;
  const BMapGL = api as {
    Icon: new (url: string, size: unknown, opts?: Record<string, unknown>) => unknown;
    Size: new (w: number, h: number) => unknown;
  };
  // 字符串内置名
  if (typeof icon === "string") {
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
  };
  const icon = buildIcon(api, p.icon);
  if (icon) opts.icon = icon;
  return new BMapGL.Marker(new BMapGL.Point(position.lng, position.lat), opts) as unknown as SdkMarker;
};

const { resource } = useOverlayResource<BMarkerProps, SdkMarker>(
  props,
  {
    create: (ready, p) => make(ready.api, p.position, p),
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      (ctx.map as { addOverlay: (o: unknown) => void }).addOverlay(res);
      (ctx as any).overlays?.register?.("marker", res);
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
          () => p.title,
          (t) => {
            const r = getResource();
            if (t != null && r) r.setTitle(t);
          },
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
            const map = ctx.map as {
              addOverlay: (o: unknown) => void;
              removeOverlay: (o: unknown) => void;
            };
            if (visible) map.addOverlay(res);
            else map.removeOverlay(res);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.enableDragging,
          (en) => {
            const r = getResource();
            if (r) en ? r.enableDragging() : r.disableDragging();
          },
        ),
      );
    },
    remove: (res, ctx) => removeOverlay(res, ctx),
  },
  "marker",
);

// SDK 事件绑定:ready 后(res 可用)调用,全部注册到 scope
function bindMarkerEvents(ctx: MapReadyContext, res: SdkMarker, scope: ResourceScope) {
  const on = (name: string, h: (e: unknown) => void) => {
    (res as any).addEventListener?.(name, h);
    scope.add(() => (res as any).removeEventListener?.(name, h));
  };
  on("click", (e) => emit("click", e));
  on("dragend", (e) => emit("dragend", e));
  on("dblclick", (e) => emit("dblclick", e));
}

// provide 必须在 setup 中调用
provide(overlayContextKey, () => resource.value);
</script>

<template>
  <slot />
</template>
