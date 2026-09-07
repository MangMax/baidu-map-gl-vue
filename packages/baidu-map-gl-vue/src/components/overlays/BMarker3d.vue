<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { toSdkPoint, toSdkSize, toSdkXYSize } from "../../core/utils/geometry";

/**
 * M4-08: BMarker3d 迁移(adapter 模式)
 *
 * position/icon 更新走字段级 setter;height/size/fill 等属性同步。
 */
export interface Marker3dCustomIcon {
  anchor?: { x: number; y: number };
  imageOffset?: { x: number; y: number };
  imageSize: { width: number; height: number };
  imageUrl: string;
  printImageUrl?: string;
}
export type Marker3dShape = "BMAP_SHAPE_CIRCLE" | "BMAP_SHAPE_RECT";

export interface BMarker3dProps {
  position: { lng: number; lat: number };
  height: number;
  size?: number;
  shape?: Marker3dShape;
  fillColor?: string;
  fillOpacity?: number;
  icon?: Marker3dCustomIcon;
  enableMassClear?: boolean;
  visible?: boolean;
}

const props = withDefaults(defineProps<BMarker3dProps>(), {
  size: 50,
  shape: "BMAP_SHAPE_CIRCLE",
  fillColor: "#f00",
  fillOpacity: 0.8,
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
  rightclick: [e: unknown];
}>();

type SdkMarker3D = {
  setPosition(p: unknown): void;
  setHeight(h: number): void;
  setFillColor(c: string): void;
  setFillOpacity(o: number): void;
  setIcon(i: unknown): void;
  enableMassClear(): void;
  disableMassClear(): void;
};

function buildIcon(api: unknown, icon: Marker3dCustomIcon): unknown {
  const Icon = (
    api as { Icon: new (url: string, size: unknown, opts?: Record<string, unknown>) => unknown }
  ).Icon;
  const options: Record<string, unknown> = {
    imageSize: toSdkSize(api, icon.imageSize),
  };
  if (icon.anchor) options.anchor = toSdkXYSize(api, icon.anchor);
  if (icon.imageOffset) options.imageOffset = toSdkXYSize(api, icon.imageOffset);
  if (icon.printImageUrl) options.printImageUrl = icon.printImageUrl;
  return new Icon(icon.imageUrl, toSdkSize(api, icon.imageSize), options);
}

/** 生成 {x,y} 形式的 Size(anchor/imageOffset 用) */
const { resource } = useOverlayResource<BMarker3dProps, SdkMarker3D>(
  props,
  {
    create: (ctx, p) => {
      const BMapGL = ctx.api as {
        Marker3D: new (pt: unknown, h: number, o?: Record<string, unknown>) => unknown;
      };
      const win = window as any;
      const shape = p.shape ?? "BMAP_SHAPE_CIRCLE";
      const shapeValue = win[shape] ?? shape;
      const options: Record<string, unknown> = {
        size: p.size,
        fillColor: p.fillColor,
        fillOpacity: p.fillOpacity,
        shape: shapeValue,
      };
      if (p.icon) options.icon = buildIcon(ctx.api, p.icon);
      return new BMapGL.Marker3D(
        toSdkPoint(ctx.api, p.position),
        p.height,
        options,
      ) as unknown as SdkMarker3D;
    },
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      const map = ctx.map as { addOverlay: (o: unknown) => void };
      if (props.visible) map.addOverlay(res);
      (ctx as any).overlays?.register?.("marker3d", res);
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
      on("rightclick", (e) => emit("rightclick", e));
    },
    createWatchers(getCtx, getResource, p, addDisposer) {
      addDisposer(
        watch(
          () => p.position,
          (pos) => {
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            if (pos && typeof pos.lng === "number") res.setPosition(toSdkPoint(ctx.api, pos));
          },
          { flush: "sync" },
        ),
      );
      addDisposer(
        watch(
          () => p.height,
          (h) => getResource()?.setHeight(h),
        ),
      );
      addDisposer(
        watch(
          () => p.fillColor,
          (c) => {
            const _v = c;
            if (_v !== undefined) getResource()?.setFillColor(_v);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.fillOpacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) getResource()?.setFillOpacity(_v);
          },
        ),
      );
      addDisposer(
        watch(
          () => p.icon,
          (icon) => {
            const res = getResource();
            const ctx = getCtx();
            if (res && ctx && icon) res.setIcon(buildIcon(ctx.api, icon));
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
  "marker3d",
);

defineOptions({ name: "BMarker3d" });
</script>

<template>
  <slot />
</template>
