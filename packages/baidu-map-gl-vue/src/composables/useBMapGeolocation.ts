/**
 * M6-05: useBMapGeolocation —— 百度 SDK 定位
 *
 * 方案 §A.9.1:当前 v2 的 `useBrowserLocation` 实际调用 BMapGL.Geolocation,
 * 并非浏览器 navigator.geolocation。v3 重命名为 useBMapGeolocation(百度 SDK),
 * 并保留 useBrowserLocation 为 deprecated alias。
 *
 * 需要地图已 ready(经 ctx.whenReady 获取 api),否则重试或报错。
 */
import { computed } from "vue";
import { useRequiredMapContext } from "../core/context/inject";
import { useBMapAsyncTask } from "./useBMapAsyncTask";
import { BMapError } from "../core/errors/BMapError";

export interface BMapGeolocationOptions {
  enableSDKLocation?: boolean;
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

export interface BMapGeoResult {
  point: { lng: number; lat: number };
  accuracy?: number;
  address?: Record<string, string>;
  status: string;
  source: "baidu-sdk";
  timestamp: number;
}

export function useBMapGeolocation(options: BMapGeolocationOptions = {}) {
  const ctx = useRequiredMapContext();

  const task = useBMapAsyncTask<BMapGeoResult, []>({
    runner: async () => {
      const ready = await ctx.whenReady();
      const api = ready.api as {
        Geolocation: new (o?: Record<string, unknown>) => {
          getCurrentPosition(cb: (res: any) => void): void;
          getStatus(): number;
        };
        Point: new (lng: number, lat: number) => { lng: number; lat: number };
      };
      const geolocation = new api.Geolocation({
        enableSDKLocation: options.enableSDKLocation,
        enableHighAccuracy: options.enableHighAccuracy,
        timeout: options.timeout,
        maximumAge: options.maximumAge,
      });

      const result = await new Promise<BMapGeoResult>((resolve, reject) => {
        geolocation.getCurrentPosition((res) => {
          const status = geolocation.getStatus();
          if (status === 0) {
            resolve({
              point: { lng: res.point.lng, lat: res.point.lat },
              accuracy: res.accuracy,
              address: res.address,
              status: "BMAP_STATUS_SUCCESS",
              source: "baidu-sdk",
              timestamp: Date.now(),
            });
          } else {
            reject(
              new BMapError(
                "BMAP_RESOURCE_CREATE_FAILED",
                `geolocation failed with status ${status}`,
              ),
            );
          }
        });
      });
      return result;
    },
  });

  return {
    data: task.data,
    /** 定位结果别名(v2 习惯) */
    location: task.data,
    error: task.error,
    isError: computed(() => task.status.value === "error"),
    status: task.status,
    isLoading: task.isLoading,
    locate: task.execute,
    /** v2 习惯别名 */
    get: task.execute,
    cancel: task.cancel,
    reset: task.reset,
  };
}


