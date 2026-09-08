/**
 * useBMapIpLocation —— IP 定位(方案 §13.2)
 *
 * 通过 SDK BMapGL.LocalCity 获取 IP 所在城市。
 * 统一异步状态(useBMapAsyncTask),不再由用户担保全局 BMapGL。
 */
import { computed } from "vue";
import { resolveMapContext } from "./resolveMapContext";
import { useBMapAsyncTask } from "./useBMapAsyncTask";

export interface BMapIpLocationResult {
  code: number;
  name: string;
  /** 定位点(与 v2 习惯一致:point) */
  point: { lng: number; lat: number };
}

export function useBMapIpLocation(map?: unknown) {
  const ctx = resolveMapContext(map);
  const task = useBMapAsyncTask<BMapIpLocationResult | null, []>({
    immediate: false,
    runner: async (_taskContext) => {
      const ready = await ctx.whenReady();
      const LocalCity = (ready.api as { LocalCity: new () => { get: (cb: (r: unknown) => void) => void } })
        .LocalCity;
      return new Promise<BMapIpLocationResult | null>((resolve) => {
        new LocalCity().get((res) => {
          const r = res as { code?: number; name?: string; center?: { lng: number; lat: number } };
          resolve(
            r.center && r.name
              ? { code: r.code ?? 0, name: r.name, point: r.center }
              : null,
          );
        });
      });
    },
  });

  return {
    location: task.data,
    isLoading: task.isLoading,
    error: task.error,
    data: task.data,
    result: task.data,
    isError: computed(() => task.status.value === "error"),
    isEmpty: computed(() => task.data.value === null),
    status: task.status,
    get: task.execute,
    cancel: task.cancel,
    reset: task.reset,
  };
}
