<script setup lang="ts">
import { watch, onMounted, onUnmounted, onScopeDispose } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { DataLayerManager } from "../../core/data/DataLayerManager";
import type { MapReadyContext } from "../../core/context/types";

/**
 * M5-03: BMarkerList —— 声明式标记列表（P0-16 实际实现名）
 *
 * 用一个组件管理整批点,内部用 DataLayerManager 做 keyed diff + RAF 合并,
 * 不为每个点创建 Vue 组件。
 *
 * 语义说明：
 * - BMarkerList：每个 item 一个 SDK Marker，适合中小规模（当前实现）。
 * - BPointCollection（规划中）：单个批量 SDK 资源，适合大规模散点。
 */
export interface BMarkerListProps<Item> {
  data: readonly Item[];
  itemKey: keyof Item | ((item: Item) => PropertyKey);
  getPosition: (item: Item) => { lng: number; lat: number };
  dataVersion?: PropertyKey;
  visible?: boolean;
}
/** @deprecated 旧名保留，语义与 BMarkerListProps 相同 */
export type BPointLayerProps<Item> = BMarkerListProps<Item>;

const props = defineProps<BMarkerListProps<any>>();

const emit = defineEmits<{
  "item-click": [item: unknown];
}>();

const ctx = useRequiredMapContext();
const scope = new ResourceScope();
let manager: DataLayerManager<any, any> | null = null;
let readyCtx: MapReadyContext | null = null;
let createMarkerRef: (() => any) | null = null;

function buildHost(c: MapReadyContext) {
  return {
    createMarker: (item: any) => {
      const BMapGL = c.api as {
        Point: new (l: number, t: number) => unknown;
        Marker: new (p: unknown, o?: Record<string, unknown>) => unknown;
      };
      const pos = props.getPosition(item);
      const m = new BMapGL.Marker(new BMapGL.Point(pos.lng, pos.lat));
      (c.map as { addOverlay: (o: unknown) => void }).addOverlay(m);
      // 事件委托:每个 marker 回传 item(通过闭包),而不为每个点建 Vue 组件
      const clickHandler = () => emit("item-click", item);
      (m as any).addEventListener?.("click", clickHandler);
      (m as any).__clickHandler = clickHandler; // 供移除时解绑
      return m;
    },
    removeMarker: (m: any) => {
      // 解绑事件委托监听(避免泄漏)
      if ((m as any).__clickHandler) {
        (m as any).removeEventListener?.("click", (m as any).__clickHandler);
        delete (m as any).__clickHandler;
      }
      (c.map as { removeOverlay: (o: unknown) => void }).removeOverlay(m);
    },
    updatePosition: (m: any, item: any) => {
      const BMapGL = c.api as { Point: new (l: number, t: number) => unknown };
      const pos = props.getPosition(item);
      (m as any).setPosition?.(new BMapGL.Point(pos.lng, pos.lat));
    },
  };
}

function applyData() {
  if (!manager || !readyCtx) return;
  manager.sync(
    props.data,
    (item: any) => {
      const keyFn =
        typeof props.itemKey === "function"
          ? props.itemKey
          : (i: any) => i[props.itemKey as string];
      return keyFn(item) as PropertyKey;
    },
    props.dataVersion,
    false,
  );
  manager.flush();
}

onMounted(async () => {
  const c = await ctx.whenReady(scope.signal);
  if (scope.isDisposed) return;
  readyCtx = c;
  manager = new DataLayerManager(buildHost(c) as any);
  await applyData();
});

onUnmounted(() => {
  manager?.dispose();
  manager = null;
  scope.dispose();
});

// data/dataVersion 变化时重新 diff
watch([() => props.data, () => props.dataVersion], () => applyData(), {
  deep: false,
  flush: "sync",
});

defineOptions({ name: "BMarkerList" });
</script>

<template>
  <slot />
</template>
