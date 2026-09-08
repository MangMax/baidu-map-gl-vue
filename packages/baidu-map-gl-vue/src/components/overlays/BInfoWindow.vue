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
  show: undefined,
  enableMaximize: false,
  enableAutoPan: true,
  enableCloseOnClick: false,
});

const emit = defineEmits<{
  "update:open": [v: boolean];
  "update:show": [v: boolean];
  open: [];
  close: [];
}>();

const ctx = useRequiredMapContext();
const shellRef = useTemplateRef<HTMLElement>("shell");
const infoWindow = shallowRef<unknown>(null);
const scope = new ResourceScope();
// P0-14: 内部 open 状态机，避免重复 emit
let lastOpenState: boolean | null = null;
let sdkReadyCtx: { map: unknown } | null = null;

type SdkInfoWindow = {
  isOpen(): boolean;
  hide(): void;
  show(): void;
  redraw(): void;
  openInfoWindow?(p: unknown): void;
  setTitle?(t: string): void;
  setContent?(c: unknown): void;
  setWidth?(w: number): void;
  setHeight?(h: number): void;
  setPosition?(p: unknown): void;
};

function isOpenProp(): boolean {
  // show 仅作为 deprecated alias
  return props.show ?? props.open;
}

function emitOpenState(open: boolean) {
  if (lastOpenState === open) return;
  lastOpenState = open;
  emit("update:open", open);
  emit("update:show", open);
  if (open) emit("open");
  else emit("close");
}

function openWindow(
  iw: SdkInfoWindow,
  BMapGL: { Point: new (lng: number, lat: number) => unknown },
  map: { openInfoWindow: (w: unknown, p: unknown) => void },
) {
  if (props.position) {
    const point = new BMapGL.Point(props.position.lng, props.position.lat);
    map.openInfoWindow(iw, point);
  } else if (iw.openInfoWindow) {
    iw.openInfoWindow(undefined);
  } else {
    iw.show();
  }
  emitOpenState(true);
}

function closeWindow(iw: SdkInfoWindow) {
  try {
    iw.hide();
  } catch {
    /* 忽略关闭错误 */
  }
  emitOpenState(false);
}

onMounted(async () => {
  const ready = await ctx.whenReady(scope.signal);
  if (scope.isDisposed) return;
  sdkReadyCtx = ready as { map: unknown };
  const BMapGL = ready.api as {
    InfoWindow: new (content: HTMLElement, opts?: Record<string, unknown>) => unknown;
    Point: new (lng: number, lat: number) => unknown;
    Size: new (w: number, h: number) => unknown;
  };
  const iw = new BMapGL.InfoWindow(shellRef.value ?? document.createElement("div"), {
    width: props.width,
    height: props.height,
    title: props.title,
    enableMaximize: props.enableMaximize,
    enableAutoPan: props.enableAutoPan,
    enableCloseOnClick: props.enableCloseOnClick,
    offset: new BMapGL.Size(props.offset.x, props.offset.y),
  }) as unknown as SdkInfoWindow;
  infoWindow.value = iw;
  (ready.map as { addOverlay: (o: unknown) => void }).addOverlay(iw);
  lastOpenState = false;

  // SDK close/open 事件 → 仅状态真实变化时回写一次
  scope.add(
    bindSdkEvent(iw as any, "close", () => {
      emitOpenState(false);
    }),
  );
  scope.add(
    bindSdkEvent(iw as any, "open", () => {
      emitOpenState(true);
    }),
  );

  // slot 内容变化 → redraw；Observer 纳入 scope，释放时 disconnect
  if (shellRef.value && typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(() => {
      try {
        iw.redraw();
      } catch {
        /* 忽略 */
      }
    });
    observer.observe(shellRef.value, { childList: true, subtree: true, characterData: true });
    scope.observe(observer);
  }

  const mapApi = ready.map as { openInfoWindow: (w: unknown, p: unknown) => void };

  // open state → SDK(状态机:prop 驱动)
  scope.add(
    watch(
      () => isOpenProp(),
      (open) => {
        if (!iw) return;
        if (open) {
          if (lastOpenState === true) return;
          openWindow(iw, BMapGL, mapApi);
        } else {
          if (lastOpenState === false) return;
          closeWindow(iw);
        }
      },
      { immediate: true },
    ),
  );

  // P0-14: 动态 props 同步
  scope.add(
    watch(
      () => props.title,
      (title) => {
        if (title == null) return;
        try {
          iw.setTitle?.(title);
          iw.redraw();
        } catch {
          /* 忽略 */
        }
      },
    ),
  );
  scope.add(
    watch(
      () => props.width,
      (w) => {
        if (w == null) return;
        try {
          iw.setWidth?.(w);
          iw.redraw();
        } catch {
          /* 忽略 */
        }
      },
    ),
  );
  scope.add(
    watch(
      () => props.height,
      (h) => {
        if (h == null) return;
        try {
          iw.setHeight?.(h);
          iw.redraw();
        } catch {
          /* 忽略 */
        }
      },
    ),
  );
  scope.add(
    watch(
      [() => props.position?.lng, () => props.position?.lat],
      ([lng, lat], [oldLng, oldLat]) => {
        if (lng == null || lat == null) return;
        if (lng === oldLng && lat === oldLat) return;
        try {
          const point = new BMapGL.Point(lng, lat);
          iw.setPosition?.(point);
          // 已打开时跟随移动
          if (lastOpenState) {
            mapApi.openInfoWindow(iw, point);
          }
        } catch {
          /* 忽略 */
        }
      },
    ),
  );
});

onUnmounted(() => {
  // P0-14: 卸载时 close + remove，不残留 overlay
  const iw = infoWindow.value as SdkInfoWindow | null;
  try {
    iw?.hide();
  } catch {
    /* 忽略 */
  }
  try {
    const map = sdkReadyCtx?.map as { removeOverlay?: (o: unknown) => void } | undefined;
    if (iw && map?.removeOverlay) map.removeOverlay(iw);
  } catch {
    /* 忽略 */
  }
  infoWindow.value = null;
  sdkReadyCtx = null;
  scope.dispose();
});
</script>

<template>
  <div ref="shell" style="display: none" v-bind="$attrs">
    <slot />
  </div>
</template>
