/**
 * M6-06: useBMapGeocoder —— 地址解析坐标
 *
 * 基于 useBMapAsyncTask 的统一异步状态,支持:
 * - 单个地址解析
 * - 批量地址解析(部分失败可表达:每项 result/error)
 *
 * 需要 BMap child context(经 ctx.whenReady 获取 api)。
 */
import { computed } from "vue";
import { resolveMapContext } from "./resolveMapContext";
import { useBMapAsyncTask } from "./useBMapAsyncTask";
import { BMapError } from "../core/errors/BMapError";

export interface GeoPoint {
  lng: number;
  lat: number;
}

export interface GeocodeItemResult {
  address: string;
  point: GeoPoint | null;
  error?: unknown;
}

export function useBMapGeocoder(map?: unknown) {
  const ctx = resolveMapContext(map);

  const task = useBMapAsyncTask<GeoPoint | null, [string, string]>({
    immediate: false,
    runner: async (_taskContext, address: string, city: string) => {
      if (!address)
        throw new BMapError("BMAP_RESOURCE_CREATE_FAILED", "missing required params: address");
      if (!city)
        throw new BMapError("BMAP_RESOURCE_CREATE_FAILED", "missing required params: city");
      const ready = await ctx.whenReady();
      const api = ready.api as {
        Geocoder: new (o?: Record<string, unknown>) => {
          getPoint(
            address: string,
            cb: (p: { lng: number; lat: number } | null) => void,
            city: string,
          ): void;
        };
      };
      const geocoder = new api.Geocoder();
      const point = await new Promise<GeoPoint | null>((resolve) => {
        geocoder.getPoint(address, (p) => resolve(p ? { lng: p.lng, lat: p.lat } : null), city);
      });
      return point;
    },
  });

  /** 批量解析,部分失败保留每项结果 */
  async function getBatch(addresses: string[], city: string): Promise<GeocodeItemResult[]> {
    const results: GeocodeItemResult[] = [];
    for (const address of addresses) {
      try {
        const point = await task.execute(address, city);
        const error = task.error.value;
        if (error) throw error;
        results.push({ address, point });
      } catch (err) {
        results.push({ address, point: null, error: err });
      }
    }
    return results;
  }

  return {
    data: task.data,
    /** 定位结果别名(v2 习惯) */
    location: task.data,
    /** 点结果别名(模板 point?.lat 习惯) */
    point: task.data,
    result: task.data,
    error: task.error,
    isError: computed(() => task.status.value === "error"),
    isEmpty: computed(() => task.data.value === null),
    status: task.status,
    isLoading: task.isLoading,
    get: task.execute,
    getBatch,
    cancel: task.cancel,
    reset: task.reset,
  };
}
