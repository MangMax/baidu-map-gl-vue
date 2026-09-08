<script setup lang="ts">
import { onMounted, onUnmounted, watch, inject } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { bindSdkEvent } from "../../core/events/EventBridge";
import { overlayContextKey } from "../../core/context/types";
import type { MapReadyContext } from "../../core/context/types";

/**
 * M4-05: BContextMenu —— 右键菜单
 *
 * 通过 typed overlay context 取得最近父 Overlay(或 map),
 * 不通过广播。父 Overlay 不存在时回退到 map。
 *
 * P0-15: target 原子切换——从旧 target 移除后再挂到新 target；
 * visible=false 时 detach；open/close 只对应 SDK 真正展开/关闭事件。
 */
export interface ContextMenuItem {
  text: string;
  callback: (...args: any[]) => void;
  disabled?: boolean;
}
export type ContextMenuSeparator = "-";

export interface BContextMenuProps {
  width?: number;
  visible?: boolean;
  menuItems?: (ContextMenuItem | ContextMenuSeparator)[];
}

const props = withDefaults(defineProps<BContextMenuProps>(), {
  width: 100,
  visible: true,
  menuItems: () => [],
});

const emit = defineEmits<{
  open: [];
  close: [];
}>();

const ctx = useRequiredMapContext();
const scope = new ResourceScope();
// 最近父 Overlay 实例(从中注入;不在 overlay 下则为 null)
const parentOverlay = inject(overlayContextKey, null) as (() => unknown) | null;

type MenuTarget = {
  addContextMenu?: (menu: unknown) => void;
  removeContextMenu?: (menu: unknown) => void;
};

let contextMenu: unknown = null;
let currentTarget: MenuTarget | null = null;
let readyCtx: MapReadyContext | null = null;
let sdkApi: unknown = null;

function buildMenu(api: unknown) {
  const BMapGL = api as {
    ContextMenu: new () => unknown;
    MenuItem: new (
      text: string,
      cb: (...args: any[]) => void,
      opts?: Record<string, unknown>,
    ) => unknown;
  };
  const menu = new BMapGL.ContextMenu() as {
    addItem: (i: unknown) => void;
    addSeparator: () => void;
  };
  for (const item of props.menuItems ?? []) {
    if (item === "-") {
      menu.addSeparator();
      continue;
    }
    const i = item as ContextMenuItem;
    const menuItem = new BMapGL.MenuItem(
      i.text,
      (point: unknown, pixel: unknown) => {
        i.callback({ point, pixel, map: ctx.map.value, BMapGL: api, target: currentTarget });
      },
      { width: props.width },
    );
    menu.addItem(menuItem);
  }
  return menu;
}

/** P0-15: 原子切换——先从旧 target 移除，再挂到新 target */
function attachTo(next: MenuTarget | null) {
  const previous = currentTarget;
  if (previous && previous !== next && contextMenu && previous.removeContextMenu) {
    try {
      previous.removeContextMenu(contextMenu);
    } catch {
      /* 忽略旧 target 移除错误 */
    }
  }
  currentTarget = next;
  if (currentTarget && contextMenu && props.visible !== false && currentTarget.addContextMenu) {
    try {
      currentTarget.addContextMenu(contextMenu);
    } catch {
      /* 忽略挂载错误 */
    }
  }
}

function detach() {
  if (currentTarget && contextMenu && currentTarget.removeContextMenu) {
    try {
      currentTarget.removeContextMenu(contextMenu);
    } catch {
      /* 忽略 */
    }
  }
}

/** menuItems 变化：SDK 无增量能力时原子重建菜单 */
function rebuildMenu() {
  if (!sdkApi || !readyCtx) return;
  detach();
  contextMenu = buildMenu(sdkApi);
  bindMenuOpenClose(contextMenu);
  if (currentTarget && props.visible !== false) {
    attachTo(currentTarget);
  }
}

function bindMenuOpenClose(menu: unknown) {
  // open/close 只对应 SDK 菜单真正展开/关闭事件，不对应 attach/detach
  try {
    scope.add(bindSdkEvent(menu as any, "open", () => emit("open")));
    scope.add(bindSdkEvent(menu as any, "close", () => emit("close")));
  } catch {
    /* 无事件能力的 SDK 忽略 */
  }
}

onMounted(async () => {
  const ready = await ctx.whenReady(scope.signal);
  if (scope.isDisposed) return;
  readyCtx = ready;
  sdkApi = ready.api;
  // 等待父 overlay 实例就绪(可能晚于 map ready),用 watch 响应变化
  contextMenu = buildMenu(ready.api);
  bindMenuOpenClose(contextMenu);
  let disposeWatch: (() => void) | null = null;
  disposeWatch = watch(
    () => (parentOverlay ? (parentOverlay() as MenuTarget | null) : null),
    (overlay) => {
      if (scope.isDisposed) return;
      const next = overlay ?? (ready.map as MenuTarget);
      attachTo(next);
    },
    { immediate: true, flush: "sync" },
  );
  scope.add(() => disposeWatch?.());

  // visible=false 应从 target 移除或禁用
  scope.add(
    watch(
      () => props.visible,
      (visible) => {
        if (!currentTarget || !contextMenu) return;
        if (visible === false) {
          detach();
        } else {
          attachTo(currentTarget);
        }
      },
    ),
  );

  // menuItems 变化：原子重建
  scope.add(
    watch(
      () => props.menuItems,
      () => rebuildMenu(),
      { deep: true },
    ),
  );
});

onUnmounted(() => {
  detach();
  contextMenu = null;
  currentTarget = null;
  readyCtx = null;
  scope.dispose();
});

defineOptions({ name: "BContextMenu" });
</script>

<template>
  <slot />
</template>
