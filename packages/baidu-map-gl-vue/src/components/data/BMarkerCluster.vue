<script setup lang="ts">
import { watch, onMounted, onUnmounted } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { DataLayerManager } from "../../core/data/DataLayerManager";
import { gridCluster, type Cluster } from "../../core/data/gridCluster";
import type { PointLike } from "../../core/utils/geometry";
import type { MapReadyContext } from "../../core/context/types";

/**
 * M5-02: BMarkerCluster —— 声明式聚合组件
 *
 * 数据驱动:一个组件管理整批点,用内置网格聚合生成簇 marker,
 * 不做逐点 Vue 组件。事件经簇级委托回传 item-cluster / item-click。
 */
export interface BMarkerClusterProps {
  data: readonly any[];
  itemKey: keyof any | ((item: any) => PropertyKey);
  getPosition: (item: any) => PointLike;
  minClusterSize?: number;
  gridSize?: number;
  /** 聚合 zoom；默认读取地图初始 zoom，未提供时为 12 */
  zoom?: number;
  dataVersion?: PropertyKey;
  visible?: boolean;
}

const props = defineProps<BMarkerClusterProps>();

const emit = defineEmits<{
  "cluster-click": [cluster: Cluster<any>];
  "item-click": [item: unknown];
}>();

const ctx = useRequiredMapContext();
const scope = new ResourceScope();
let manager: DataLayerManager<any, any> | null = null;
let readyCtx: MapReadyContext | null = null;

function buildHost(c: MapReadyContext) {
  return {
    createMarker: (cluster: Cluster<any>) => {
      const BMapGL = c.api as {
        Point: new (l: number, t: number) => unknown;
        Marker: new (p: unknown, o?: Record<string, unknown>) => unknown;
        Icon: new (url: string, size: unknown, opts?: Record<string, unknown>) => unknown;
        Size: new (w: number, h: number) => unknown;
      };
      const pos = cluster.position;
      // 簇 marker 带计数 label
      const m = new BMapGL.Marker(new BMapGL.Point(pos.lng, pos.lat), {
        title: `${cluster.size}`,
      });
      (c.map as { addOverlay: (o: unknown) => void }).addOverlay(m);
      const clickHandler = () => {
        if (cluster.size >= (props.minClusterSize ?? 3)) emit("cluster-click", cluster);
        else emit("item-click", cluster.points[0]);
      };
      (m as any).addEventListener?.("click", clickHandler);
      (m as any).__clickHandler = clickHandler;
      return m;
    },
    removeMarker: (m: any) => {
      if ((m as any).__clickHandler) {
        (m as any).removeEventListener?.("click", (m as any).__clickHandler);
        delete (m as any).__clickHandler;
      }
      (c.map as { removeOverlay: (o: unknown) => void }).removeOverlay(m);
    },
    updatePosition: (m: any, cluster: Cluster<any>) => {
      const BMapGL = c.api as { Point: new (l: number, t: number) => unknown };
      (m as any).setPosition?.(new BMapGL.Point(cluster.position.lng, cluster.position.lat));
    },
  };
}

function resolveZoom(c: MapReadyContext): number {
  if (props.zoom != null) return props.zoom;
  const map = c.map as { getZoom?: () => number; zoom?: number } | null;
  try {
    if (typeof map?.getZoom === "function") return map.getZoom();
    if (typeof map?.zoom === "number") return map.zoom;
  } catch {
    /* 忽略 */
  }
  return 8;
}

function applyData() {
  if (!manager || !readyCtx) return;
  // P0-17: gridSize/zoom 参与像素网格聚合；低于阈值的桶展开为单点，不丢点
  const clustered = gridCluster(props.data, props.getPosition, {
    minClusterSize: props.minClusterSize ?? 3,
    gridSize: props.gridSize ?? 128,
    zoom: resolveZoom(readyCtx),
  });
  // 以 cluster.id 为 key
  manager.sync(clustered, (c: any) => c.id, props.dataVersion, false);
  manager.flush();
}

onMounted(async () => {
  const c = await ctx.whenReady(scope.signal);
  if (scope.isDisposed) return;
  readyCtx = c;
  manager = new DataLayerManager(buildHost(c));
  applyData();
});

onUnmounted(() => {
  manager?.dispose();
  manager = null;
  scope.dispose();
});

watch([() => props.data, () => props.dataVersion], () => applyData(), {
  deep: false,
  flush: "sync",
});

defineOptions({ name: "BMarkerCluster" });
</script>

<template>
  <slot />
</template>
