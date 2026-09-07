/**
 * useBMapGeocodeDetail —— 坐标点反查地址详情(方案 §13.2)
 *
 * 对应 v2 usePointGeocoder 语义:点 → 地址详情
 * (point/address/addressComponents/business/surroundingPois)。
 * 统一异步状态;SDK 经 map context ready。
 */
import { computed } from "vue";
import { resolveMapContext } from "./resolveMapContext";
import { useBMapAsyncTask } from "./useBMapAsyncTask";
import { BMapError } from "../core/errors/BMapError";

export interface GeocodeDetailResult {
  point: { lng: number; lat: number };
  address: string;
  addressComponents: {
    city: string;
    district: string;
    province: string;
    street: string;
    streetNumber: string;
  };
  surroundingPois: Array<{ title: string; point: { lng: number; lat: number } }>;
  business: string;
}

function toPlainPoint(p: { lng: number; lat: number }): { lng: number; lat: number } {
  return { lng: p.lng, lat: p.lat };
}

export function useBMapGeocodeDetail(map?: unknown) {
  const ctx = resolveMapContext(map);
  const task = useBMapAsyncTask<GeocodeDetailResult | null, [{ lng: number; lat: number }]>({
    immediate: false,
    runner: async (point) => {
      if (!point || typeof point.lng !== "number")
        throw new BMapError("BMAP_INVALID_POINT", "missing required params: point");
      const ready = await ctx.whenReady();
      const api = ready.api as {
        Geocoder: new (o?: Record<string, unknown>) => {
          getLocation(
            p: { lng: number; lat: number },
            cb: (r: Record<string, unknown> | null) => void,
          ): void;
        };
      };
      const geocoder = new api.Geocoder();
      return new Promise<GeocodeDetailResult | null>((resolve) => {
        geocoder.getLocation(point, (r) => {
          if (!r) return resolve(null);
          const g = r as unknown as {
            point?: { lng: number; lat: number };
            address?: string;
            addressComponents?: GeocodeDetailResult["addressComponents"];
            surroundingPois?: Array<{ title?: string; point?: { lng: number; lat: number } }>;
            business?: string;
          };
          resolve({
            point: g.point ? toPlainPoint(g.point) : { lng: point.lng, lat: point.lat },
            address: g.address ?? "",
            addressComponents: g.addressComponents ?? {
              city: "",
              district: "",
              province: "",
              street: "",
              streetNumber: "",
            },
            surroundingPois: (g.surroundingPois ?? []).map((p) => ({
              title: p.title ?? "",
              point: p.point ? toPlainPoint(p.point) : { lng: 0, lat: 0 },
            })),
            business: g.business ?? "",
          });
        });
      });
    },
  });

  /** 批量反查地址详情,部分失败保留每项结果 */
  async function getBatch(
    points: { lng: number; lat: number }[],
  ): Promise<Array<{ point: { lng: number; lat: number }; detail: GeocodeDetailResult | null; error?: unknown }>> {
    const results: Array<{ point: { lng: number; lat: number }; detail: GeocodeDetailResult | null; error?: unknown }> = [];
    for (const point of points) {
      try {
        const detail = await task.execute(point);
        const error = task.error.value;
        if (error) throw error;
        results.push({ point, detail });
      } catch (err) {
        results.push({ point, detail: null, error: err });
      }
    }
    return results;
  }

  return {
    data: task.data,
    /** 结果别名(v2 result 习惯) */
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
