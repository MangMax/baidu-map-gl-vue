<script setup lang="ts">
import { getCurrentInstance, onUpdated, ref, watch } from "vue";
import { useControlResource } from "../../core/composables/useControlResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import {
  copyrightControlPosCache,
  removeCopyrightControlIfEmpty,
  type CopyrightControl,
} from "./copyrightControlPosCache";

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

const containerRef = ref<HTMLElement | null>(null);
const id = getCurrentInstance()?.uid ?? Math.random();
let control: CopyrightControl | null = null;
let readyContext: MapReadyContext | null = null;
let registered = false;

const { resource } = useControlResource<BCopyrightProps, CopyrightControl>(props, {
  create: (ctx, p) => {
    readyContext = ctx;
    const anchor = p.anchor ?? "BMAP_ANCHOR_BOTTOM_LEFT";
    const cached = copyrightControlPosCache.get(anchor);
    if (cached) {
      control = cached;
      return cached;
    }

    const win = window as any;
    const api = ctx.api as any;
    const created = new api.CopyrightControl({
      offset: new api.Size(p.offset?.x ?? 0, p.offset?.y ?? 0),
      anchor: win[anchor] ?? anchor,
    }) as CopyrightControl;
    control = created;
    copyrightControlPosCache.set(anchor, created);
    return created;
  },
  addToMap: (res, ctx, p, _scope: ResourceScope) => {
    const anchor = p.anchor ?? "BMAP_ANCHOR_BOTTOM_LEFT";
    if (res === copyrightControlPosCache.get(anchor)) {
      const entries = res.getCopyrightCollection?.() ?? [];
      if (entries.length === 0) {
        (ctx.map as { addControl: (control: unknown) => void }).addControl(res);
      }
    }
    readyContext = ctx;
    registerCopyright();
  },
  createWatchers(getCtx, getResource, p, addDisposer) {
    const stop = watch(
      () => p.visible,
      (visible) => {
        const res = getResource();
        const ctx = getCtx();
        if (!res || !ctx) return;
        if (visible) registerCopyright();
        else {
          res.removeCopyright(id);
          registered = false;
        }
      },
    );
    addDisposer(stop);
  },
  remove: (res, ctx) => {
    const anchor = props.anchor ?? "BMAP_ANCHOR_BOTTOM_LEFT";
    res.removeCopyright(id);
    registered = false;
    removeCopyrightControlIfEmpty(anchor, res, ctx);
    if (control === res) control = null;
    readyContext = null;
  },
});

function registerCopyright() {
  if (registered || !props.visible || !control || !readyContext || !containerRef.value) return;
  control.addCopyright({
    id,
    content: containerRef.value.innerHTML,
    bounds: (readyContext.map as { getBounds?: () => unknown }).getBounds?.(),
  });
  registered = true;
}

onUpdated(() => {
  if (!control || !containerRef.value || !registered) return;
  const current = control.getCopyrightCollection?.().find((item) => item.id === id);
  if (!current || current.content === containerRef.value.innerHTML) return;
  control.addCopyright({
    id,
    content: containerRef.value.innerHTML,
    bounds: current.bounds,
  });
});

defineOptions({ name: "BCopyright", inheritAttrs: false });
</script>

<template>
  <div style="display: none">
    <div ref="containerRef" v-bind="$attrs">
      <slot />
    </div>
  </div>
</template>
