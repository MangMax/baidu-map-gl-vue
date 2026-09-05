<script setup lang="ts">
import { watch, ref } from "vue";
import { useControlResource } from "../../core/composables/useControlResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";

export interface BCopyrightProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

const props = withDefaults(defineProps<BCopyrightProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  offset: () => ({ x: 83, y: 18 }),
  visible: true,
});

type SdkControl = {
  setCopyright?: (el: HTMLElement) => void;
  setOptions?: (o: Record<string, unknown>) => void;
};

const containerRef = ref<HTMLElement | null>(null);

const { resource } = useControlResource<BCopyrightProps, SdkControl>(props, {
  create: (ctx, p) => {
    const anchor = p.anchor ?? "BMAP_ANCHOR_TOP_LEFT";
    const offset = p.offset ?? { x: 0, y: 0 };
    const win = window as any;
    const control = new (ctx.api as any).CopyrightControl({
      offset: new (ctx.api as any).Size(offset.x, offset.y),
      anchor: win[anchor] ?? anchor,
    }) as unknown as SdkControl;
    // 版权内容取 slot 容器
    if (containerRef.value) control.setCopyright?.(containerRef.value);
    return control;
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

defineOptions({ name: "BCopyright" });
</script>

<template>
  <div ref="container" style="display: none">
    <slot />
  </div>
</template>
