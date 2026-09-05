<script setup lang="ts">
import { onMounted, onUnmounted, watch, inject } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { overlayContextKey } from "../../core/context/types";

/**
 * M4-05: BContextMenu —— 右键菜单
 *
 * 通过 typed overlay context 取得最近父 Overlay(或 map),
 * 不通过广播。父 Overlay 不存在时回退到 map。
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

let contextMenu: unknown = null;
let target: any = null;

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
        i.callback({ point, pixel, map: ctx.map.value, BMapGL: api, target });
      },
      { width: props.width },
    );
    menu.addItem(menuItem);
  }
  return menu;
}

onMounted(async () => {
  const ready = await ctx.whenReady(scope.signal);
  if (scope.isDisposed) return;
  // 等待父 overlay 实例就绪(可能晚于 map ready),用 watch 响应变化
  contextMenu = buildMenu(ready.api);
  let disposeWatch: (() => void) | null = null;
  disposeWatch = watch(
    () => (parentOverlay ? parentOverlay() : null),
    (overlay) => {
      if (scope.isDisposed) return;
      const targetInstance = overlay ?? (ready.map as any);
      if (targetInstance && targetInstance.addContextMenu) {
        target = targetInstance;
        target.addContextMenu(contextMenu);
        emit("open");
      }
    },
    { immediate: true, flush: "sync" },
  );
  scope.add(() => disposeWatch?.());
});

onUnmounted(() => {
  if (target && contextMenu && target.removeContextMenu) {
    target.removeContextMenu(contextMenu);
  }
  scope.dispose();
});

defineOptions({ name: "BContextMenu" });
</script>

<template>
  <slot />
</template>
