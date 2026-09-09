<script setup lang="ts">
import { getCurrentInstance, onUpdated, ref, watch } from "vue";
import { useControlResource } from "../../core/composables/useControlResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { ControlHandle } from "../../driver/types/handles";
import {
  copyrightControlPosCache,
  removeCopyrightControlIfEmpty,
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
let control: ControlHandle | null = null;
let readyContext: MapReadyContext | null = null;
let registered = false;

const { resource } = useControlResource<BCopyrightProps, ControlHandle>(props, {
  create: (ctx, p) => {
    readyContext = ctx;
    const anchor = p.anchor ?? "BMAP_ANCHOR_BOTTOM_LEFT";
    const cached = copyrightControlPosCache.get(anchor);
    if (cached) {
      control = cached;
      return cached;
    }
    const created = ctx.client.driver.controls.create("copyright", {
      anchor,
      offset: p.offset,
    });
    control = created;
    copyrightControlPosCache.set(anchor, created);
    return created;
  },
  addToMap: (res, ctx, p, _scope: ResourceScope) => {
    const anchor = p.anchor ?? "BMAP_ANCHOR_BOTTOM_LEFT";
    if (res === copyrightControlPosCache.get(anchor)) {
      const entries = ctx.client.driver.controls.listCopyrights(res);
      if (entries.length === 0) {
        ctx.client.driver.controls.add({ kind: "map", handle: ctx.map }, res);
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
          ctx.client.driver.controls.removeCopyright(res, id);
          registered = false;
        }
      },
    );
    addDisposer(stop);
  },
  remove: (res, ctx) => {
    const anchor = props.anchor ?? "BMAP_ANCHOR_BOTTOM_LEFT";
    ctx.client.driver.controls.removeCopyright(res, id);
    registered = false;
    removeCopyrightControlIfEmpty(anchor, res, ctx);
    if (control === res) control = null;
    readyContext = null;
  },
});

function registerCopyright() {
  if (registered || !props.visible || !control || !readyContext || !containerRef.value) return;
  const ctx = readyContext;
  let bounds: unknown;
  try {
    bounds = ctx.client.driver.map.getBounds(ctx.map);
  } catch {
    bounds = undefined;
  }
  ctx.client.driver.controls.addCopyright(control, {
    id,
    content: containerRef.value.innerHTML,
    bounds,
  });
  registered = true;
}

onUpdated(() => {
  if (!control || !containerRef.value || !registered || !readyContext) return;
  const ctx = readyContext;
  const current = ctx.client.driver.controls
    .listCopyrights(control)
    .find((item) => item.id === id);
  if (!current || current.content === containerRef.value.innerHTML) return;
  ctx.client.driver.controls.addCopyright(control, {
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
