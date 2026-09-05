/**
 * M6-06: useBMapConvertor —— 坐标转换
 *
 * 复用 useBMapAsyncTask 统一异步状态(§13.3)。
 * 支持从/到坐标类型枚举(v2 CoordinatesFromType/ToType 断点兼容)。
 */
import { computed } from "vue";
import { useRequiredMapContext } from "../core/context/inject";
import { useBMapAsyncTask } from "./useBMapAsyncTask";
import { BMapError } from "../core/errors/BMapError";
import type { GeoPoint } from "./useBMapGeocoder";

export enum CoordinatesFromType {
  COORDINATES_WGS84 = 1,
  COORDINATES_WGS84_MC = 2,
  COORDINATES_GCJ02 = 3,
  COORDINATES_GCJ02_MC = 4,
  COORDINATES_BD09 = 5,
  COORDINATES_BD09_MC = 6,
  COORDINATES_MAPBAR = 7,
  COORDINATES_51 = 8,
}

export enum CoordinatesToType {
  COORDINATES_GCJ02 = 3,
  COORDINATES_BD09 = 5,
  COORDINATES_BD09_MC = 6,
}

export type { GeoPoint };

export function useBMapConvertor() {
  const ctx = useRequiredMapContext();

  const task = useBMapAsyncTask<GeoPoint[], [GeoPoint[], CoordinatesFromType, CoordinatesToType]>({
    runner: async (points, from, to) => {
      if (!points?.length)
        throw new BMapError("BMAP_RESOURCE_CREATE_FAILED", "missing required params: points");
      if (!from)
        throw new BMapError("BMAP_RESOURCE_CREATE_FAILED", "missing required params: from");
      if (!to) throw new BMapError("BMAP_RESOURCE_CREATE_FAILED", "missing required params: to");
      const ready = await ctx.whenReady();
      const api = ready.api as {
        Point: new (lng: number, lat: number) => { lng: number; lat: number };
        Convertor: new (o?: Record<string, unknown>) => {
          translate(
            points: { lng: number; lat: number }[],
            from: number,
            to: number,
            cb: (res: { points: { lng: number; lat: number }[]; status: number }) => void,
          ): void;
        };
      };
      const convertor = new api.Convertor();
      const pointsInstance = points.map((p) => new api.Point(p.lng, p.lat));
      const res = await new Promise<{ points: { lng: number; lat: number }[]; status: number }>(
        (resolve, reject) => {
          convertor.translate(pointsInstance, from, to, (r) => {
            if (r.status === 0) resolve(r);
            else
              reject(
                new BMapError(
                  "BMAP_RESOURCE_CREATE_FAILED",
                  `convert failed with status ${r.status}`,
                ),
              );
          });
        },
      );
      return res.points.map((p) => ({ lng: p.lng, lat: p.lat }));
    },
  });

  return {
    data: task.data,
    /** 结果别名(v2 习惯) */
    result: task.data,
    error: task.error,
    isError: computed(() => task.status.value === "error"),
    isEmpty: computed(() => !task.data.value?.length),
    status: task.status,
    isLoading: task.isLoading,
    convert: task.execute,
    /** v2 习惯别名 */
    get: task.execute,
    cancel: task.cancel,
    reset: task.reset,
  };
}
