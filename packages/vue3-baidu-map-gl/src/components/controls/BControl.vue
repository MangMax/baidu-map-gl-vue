<script setup lang="ts">
import { watch, ref } from "vue";
import { useControlResource } from "../../core/composables/useControlResource";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";

/**
 * M6-01: BControl 迁移 —— 自定义控件(slot DOM)
 *
 * 创建 BMapGL.Control,把 slot 容器 append 到地图容器,
 * anchor/offset/visible 与其他 Control 一致(useControlResource)。
 */

export interface BControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

const props = withDefaults(defineProps<BControlProps>(), {
  anchor: "BMAP_ANCHOR_TOP_LEFT",
  offset: () => ({ x: 83, y: 18 }),
  visible: true,
});

type SdkControl = {
  defaultAnchor?: unknown;
  defaultOffset?: unknown;
  initialize?: (map: unknown) => HTMLElement;
};

const containerRef = ref<HTMLElement | null>(null);

const { resource } = useControlResource<BControlProps, SdkControl>(props, {
  create: (ctx, p) => {
    const anchor = p.anchor ?? "BMAP_ANCHOR_TOP_LEFT";
    const offset = p.offset ?? { x: 0, y: 0 };
    const BMapGL = ctx.api as {
      Control: new () => unknown;
      Size: new (w: number, h: number) => unknown;
    };
    const win = window as any;
    const anchorValue = win[anchor] ?? anchor;
    const customControl = new BMapGL.Control() as SdkControl;
    customControl.defaultAnchor = anchorValue;
    customControl.defaultOffset = new BMapGL.Size(offset.x, offset.y);
    customControl.initialize = (map: unknown) => {
      const containerEl = containerRef.value;
      const mapContainer = (map as { getContainer: () => HTMLElement }).getContainer();
      if (!containerEl) return mapContainer;
      return mapContainer.appendChild(containerEl as Node) as HTMLElement;
    };
    return customControl;
  },
  addToMap: (res, ctx, p, scope: ResourceScope) => {
    if (props.visible) (ctx.map as { addControl: (c: unknown) => void }).addControl(res);
    (ctx as any).overlays?.register?.("control", res);
  },
  createWatchers(getCtx, getResource, p, addDisposer) {
    addDisposer(
      watch(
        () => p.visible,
        (v) => {
          const res = getResource();
          const ctx = getCtx();
          if (!res || !ctx) return;
          const map = ctx.map as {
            addControl: (c: unknown) => void;
            removeControl: (c: unknown) => void;
          };
          if (v) map.addControl(res);
          else map.removeControl(res);
        },
      ),
    );
  },
  remove: (res, ctx) => {
    (ctx.map as { removeControl: (c: unknown) => void }).removeControl(res);
  },
});

defineOptions({ name: "BControl", inheritAttrs: false });
</script>

<template>
  <div style="display: none">
    <div ref="containerRef" v-bind="$attrs">
      <slot />
    </div>
  </div>
</template>
