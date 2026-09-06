<script setup lang="ts">
import { watch } from "vue";
import type { MapMaskShowRegion } from "../../types/components";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { toSdkPoints } from "../../core/utils/geometry";

/**
 * M4-08: BMapMask 迁移(adapter 模式)
 *
 * path 视为不可变值,更新后替换根引用触发;支持 pathVersion 强制刷新。
 */
export interface BMapMaskProps {
  path: { lng: number; lat: number }[];
  pathVersion?: string | number;
  showRegion?: MapMaskShowRegion;
  isBuildingMask?: boolean;
  isMapMask?: boolean;
  isPoiMask?: boolean;
  visible?: boolean;
}

const props = withDefaults(defineProps<BMapMaskProps>(), {
  showRegion: "inside",
  isBuildingMask: false,
  isMapMask: false,
  isPoiMask: false,
  visible: true,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
  mousedown: [e: unknown];
  mouseup: [e: unknown];
  mouseout: [e: unknown];
  mouseover: [e: unknown];
  rightclick: [e: unknown];
}>();

type SdkMapMask = object;

const { resource } = useOverlayResource<BMapMaskProps, SdkMapMask>(
  props,
  {
    create: (ctx, p) => {
      const BMapGL = ctx.api as {
        MapMask: new (pts: unknown[], o?: Record<string, unknown>) => unknown;
      };
      return new BMapGL.MapMask(toSdkPoints(ctx.api, p.path), {
        showRegion: p.showRegion,
        isBuildingMask: p.isBuildingMask,
        isMapMask: p.isMapMask,
        isPoiMask: p.isPoiMask,
      }) as unknown as SdkMapMask;
    },
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      const map = ctx.map as { addOverlay: (o: unknown) => void };
      if (props.visible) map.addOverlay(res);
      (ctx as any).overlays?.register?.("mapmask", res);
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
      on("rightclick", (e) => emit("rightclick", e));
    },
    createWatchers(getCtx, getResource, p, addDisposer) {
      // SDK MapMask 不可变(path 只能构造时传入)。path 更新由使用方
      // 通过 pathVersion 变化触发重建(见下方)。
      // 注意:不能在此处用 watch 重建,否则初始挂载会重复创建。
      void getCtx;
      void getResource;
      void p;
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
  "mapmask",
);

defineOptions({ name: "BMapMask" });
</script>

<template>
  <slot />
</template>
