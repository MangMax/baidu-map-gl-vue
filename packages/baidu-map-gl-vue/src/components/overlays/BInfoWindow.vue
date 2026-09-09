<script setup lang="ts">
import { shallowRef, onMounted, onUnmounted, watch, useTemplateRef } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { InfoWindowHandle } from "../../driver/types/handles";
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
const infoWindow = shallowRef<InfoWindowHandle | null>(null);
const scope = new ResourceScope();
// 内部 open 状态机，避免重复 emit
let lastOpenState: boolean | null = null;
let readyClient: any = null;
let readyMap: any = null;

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

function openWindow(iw: InfoWindowHandle) {
  if (props.position) {
    readyClient.driver.overlays.openInfoWindow(readyMap, iw, props.position);
  } else {
    readyClient.driver.overlays.openInfoWindow(readyMap, iw);
  }
  emitOpenState(true);
}

function closeWindow(iw: InfoWindowHandle) {
  try {
    readyClient.driver.overlays.closeInfoWindow(iw);
  } catch {
    /* 忽略关闭错误 */
  }
  emitOpenState(false);
}

onMounted(async () => {
  const ready = await ctx.whenReady(scope.signal);
  if (scope.isDisposed) return;
  readyClient = ready.client;
  readyMap = ready.map;

  const iw = readyClient.driver.overlays.createInfoWindow(
    shellRef.value ?? document.createElement("div"),
    {
      width: props.width,
      height: props.height,
      title: props.title,
      enableMaximize: props.enableMaximize,
      enableAutoPan: props.enableAutoPan,
      enableCloseOnClick: props.enableCloseOnClick,
      offset: props.offset,
    },
  );
  infoWindow.value = iw;
  readyClient.driver.overlays.add({ kind: "map", handle: ready.map }, iw);
  lastOpenState = false;

  // SDK close/open 事件 → 仅状态真实变化时回写一次
  scope.add(
    readyClient.driver.events.on(iw, "close", () => {
      emitOpenState(false);
    }),
  );
  scope.add(
    readyClient.driver.events.on(iw, "open", () => {
      emitOpenState(true);
    }),
  );

  // slot 内容变化 → redraw；Observer 纳入 scope，释放时 disconnect
  if (shellRef.value && typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(() => {
      try {
        readyClient.driver.overlays.redrawInfoWindow(iw);
      } catch {
        /* 忽略 */
      }
    });
    observer.observe(shellRef.value, { childList: true, subtree: true, characterData: true });
    scope.observe(observer);
  }

  // open state → SDK(状态机:prop 驱动)
  scope.add(
    watch(
      () => isOpenProp(),
      (open) => {
        if (!iw) return;
        if (open) {
          if (lastOpenState === true) return;
          openWindow(iw);
        } else {
          if (lastOpenState === false) return;
          closeWindow(iw);
        }
      },
      { immediate: true },
    ),
  );

  // 动态 props 同步
  scope.add(
    watch(
      () => props.title,
      (title) => {
        if (title == null) return;
        try {
          readyClient.driver.overlays.setOptions(iw, { title });
          readyClient.driver.overlays.redrawInfoWindow(iw);
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
          readyClient.driver.overlays.setOptions(iw, { width: w });
          readyClient.driver.overlays.redrawInfoWindow(iw);
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
          readyClient.driver.overlays.setOptions(iw, { height: h });
          readyClient.driver.overlays.redrawInfoWindow(iw);
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
          readyClient.driver.overlays.setOptions(iw, { position: { lng, lat } });
          // 已打开时跟随移动
          if (lastOpenState) {
            readyClient.driver.overlays.openInfoWindow(readyMap, iw, { lng, lat });
          }
        } catch {
          /* 忽略 */
        }
      },
    ),
  );
});

onUnmounted(() => {
  // 卸载时 close + remove，不残留 overlay
  const iw = infoWindow.value;
  try {
    if (iw && readyClient) readyClient.driver.overlays.closeInfoWindow(iw);
  } catch {
    /* 忽略 */
  }
  try {
    if (iw && readyMap) {
      readyClient.driver.overlays.remove({ kind: "map", handle: readyMap }, iw);
    }
  } catch {
    /* 忽略 */
  }
  infoWindow.value = null;
  scope.dispose();
});
</script>

<template>
  <div ref="shell" style="display: none" v-bind="$attrs">
    <slot />
  </div>
</template>
