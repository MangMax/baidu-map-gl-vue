/**
 * M5-02: 网格聚合算法(纯函数,可单测)
 *
 * 依据给定 zoom 对点集做网格聚合:同一网格内的点合并为一个簇。
 * 供 BMarkerCluster 内置实现使用,不依赖任何第三方插件。
 */
import type { PointLike } from "../utils/geometry";

export interface Cluster<Item> {
  id: string;
  points: Item[];
  position: { lng: number; lat: number };
  size: number;
}

export interface ClusterOptions {
  /** 网格大小(像素),越大簇越粗 */
  gridSize?: number;
  /** 触发聚合的最小点数,小于该值保持独立 marker */
  minClusterSize?: number;
}

/**
 * 简单网格聚合:按经纬度均分网格单元,同单元设一个簇。
 * 不含完整金字塔/相交聚合,但满足"数据组件 + 聚合"的可测试最小实现。
 */
export function gridCluster<Item>(
  items: readonly Item[],
  getPosition: (item: Item) => PointLike,
  options: ClusterOptions = {},
): Cluster<Item>[] {
  const gridSize = options.gridSize ?? 64;
  const minClusterSize = options.minClusterSize ?? 3;
  const buckets = new Map<string, Item[]>();
  const centers = new Map<string, { lng: number; lat: number }>();

  for (const item of items) {
    const pos = getPosition(item);
    const lngCell = Math.floor(pos.lng * 10); // 以 ~0.1° 为网格单元
    const latCell = Math.floor(pos.lat * 10);
    const key = `${lngCell}:${latCell}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      centers.set(key, pos);
    }
    bucket.push(item);
  }

  const clusters: Cluster<Item>[] = [];
  for (const [key, bucket] of buckets) {
    const center = centers.get(key)!;
    // 计算簇真实质心
    let sumLng = 0;
    let sumLat = 0;
    for (const it of bucket) {
      const p = getPosition(it);
      sumLng += p.lng;
      sumLat += p.lat;
    }
    const centroid = { lng: sumLng / bucket.length, lat: sumLat / bucket.length };
    const isCluster = bucket.length >= minClusterSize;
    clusters.push({
      id: isCluster ? `c-${key}` : key,
      points: bucket,
      position: isCluster ? centroid : center,
      size: bucket.length,
    });
  }
  return clusters;
}
