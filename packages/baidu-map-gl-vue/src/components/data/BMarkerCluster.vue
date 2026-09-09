<script setup lang="ts">
import { watch, onMounted, onUnmounted } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { DataLayerManager } from "../../core/data/DataLayerManager";
import { gridCluster, type Cluster } from "../../core/data/gridCluster";
import type { PointLike } from "../../core/utils/geometry";
import type { MapReadyContext } from "../../core/context/types";
import type { MarkerHandle } from "../../driver/types/handles";

/**
 * BMarkerCluster —— 声明式聚合组件
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

// 事件委托 disposer 以 WeakMap 存储(Handle 被 freeze,不可附加属性)
const clickDisposers = new WeakMap<object, () => void>();

function buildHost(c: MapReadyContext) {
  const driver = c.client.driver;
  const target = { kind: "map" as const, handle: c.map };
  return {
    createMarker: (cluster: Cluster<any>) => {
      const pos = cluster.position;
      // 簇 marker 带计数 label
      const marker = driver.overlays.createMarker(pos, {
        title: `${cluster.size}`,
      });
      driver.overlays.add(target, marker);
      const clickHandler = () => {
        if (cluster.size >= (props.minClusterSize ?? 3)) emit("cluster-click", cluster);
        else emit("item-click", cluster.points[0]);
      };
      clickDisposers.set(
        marker as object,
        driver.events.on(marker, "click", clickHandler),
      );
      return marker;
    },
    removeMarker: (m: MarkerHandle) => {
      clickDisposers.get(m as object)?.();
      clickDisposers.delete(m as object);
      driver.overlays.remove(target, m);
    },
    updatePosition: (m: MarkerHandle, cluster: Cluster<any>) => {
      driver.overlays.setPosition(m, cluster.position);
    },
  };
}

function resolveZoom(c: MapReadyContext): number {
  if (props.zoom != null) return props.zoom;
  try {
    const zoom = c.client.driver.map.getZoom(c.map);
    if (typeof zoom === "number") return zoom;
  } catch {
    /* 忽略 */
  }
  return 8;
}

function applyData() {
  if (!manager || !readyCtx) return;
  // gridSize/zoom 参与像素网格聚合；低于阈值的桶展开为单点，不丢点
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
