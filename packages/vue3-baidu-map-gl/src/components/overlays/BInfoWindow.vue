<script setup lang="ts">
import { shallowRef, onMounted, onUnmounted, watch, useTemplateRef } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { bindSdkEvent } from "../../core/events/EventBridge";
import type { BInfoWindowProps } from "../../types/components";

export type { BInfoWindowProps };

const props = withDefaults(defineProps<BInfoWindowProps>(), {
  title: "",
  width: 0,
  height: 0,
  offset: () => ({ x: 0, y: 0 }),
  open: false,
});

const emit = defineEmits<{
  "update:open": [v: boolean];
    open: [];
  close: [];
}>();

const ctx = useRequiredMapContext();
const shellRef = useTemplateRef<HTMLElement>("shell");
const infoWindow = shallowRef<unknown>(null);
const scope = new ResourceScope();

type SdkInfoWindow = {
  openInfoWindow?(p: unknown): void;
  isOpen(): boolean;
  hide(): void;
  show(): void;
  redraw(): void;
};

onMounted(async () => {
  const ready = await ctx.whenReady(scope.signal);
  if (scope.isDisposed) return;
  const BMapGL = ready.api as {
    InfoWindow: new (content: HTMLElement, opts?: Record<string, unknown>) => unknown;
    Point: new (lng: number, lat: number) => unknown;
    Size: new (w: number, h: number) => unknown;
  };
  const iw = new BMapGL.InfoWindow(shellRef.value ?? document.createElement("div"), {
    width: props.width,
    height: props.height,
    title: props.title,
    offset: new BMapGL.Size(props.offset.x, props.offset.y),
  }) as unknown as SdkInfoWindow;
  infoWindow.value = iw;
  (ready.map as { addOverlay: (o: unknown) => void }).addOverlay(iw);

  // SDK close/open 事件 → 仅状态真实变化时回写一次(§11.3)
  scope.add(
    bindSdkEvent(iw as any, "close", () => {
      if (props.open) emit("update:open", false);
      emit("close");
    }),
  );
  scope.add(
    bindSdkEvent(iw as any, "open", () => {
      emit("open");
    }),
  );

  // open state → SDK(状态机:prop 驱动)
  scope.add(
    watch(
      () => props.open,
      (open) => {
        const shouldOpen = open;
        if (!iw) return;
        if (shouldOpen) {
          if (props.position) {
            const map = ready.map as { openInfoWindow: (w: unknown, p: unknown) => void };
            const point = new BMapGL.Point(props.position.lng, props.position.lat);
            map.openInfoWindow(iw, point);
          } else if (iw.openInfoWindow) {
            iw.openInfoWindow(undefined);
          }
        } else {
          iw.hide();
        }
      },
      { immediate: true },
    ),
  );
});

onUnmounted(() => {
  scope.dispose();
});
</script>

<template>
  <div ref="shell" style="display: none" v-bind="$attrs">
    <slot />
  </div>
</template>
