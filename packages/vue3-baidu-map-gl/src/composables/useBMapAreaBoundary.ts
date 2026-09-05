/**
 * useBMapAreaBoundary —— 区域边界(方案 §13.2)
 *
 * 通过 SDK BMapGL.Boundary.get(area) 获取行政区边界点串。
 * 统一异步状态;SDK 实例经 map context ready 后创建,卸载不残留。
 */
import { ref, onUnmounted, type Ref } from "vue";
import { useRequiredMapContext } from "../core/context/inject";

export type AreaBoundary = string[];

export interface UseBMapAreaBoundaryResult {
  isLoading: Ref<boolean>;
  boundaries: Ref<AreaBoundary>;
  get: (area: string) => Promise<void>;
}

export function useBMapAreaBoundary(): UseBMapAreaBoundaryResult {
  const ctx = useRequiredMapContext();
  const isLoading = ref(false);
  const boundaries = ref<AreaBoundary>([]);

  let boundaryInstance: { get: (area: string, cb: (r: { boundaries: string[] }) => void) => void } | null =
    null;

  async function get(area: string) {
    if (!boundaryInstance) {
      const ready = await ctx.whenReady();
      const Boundary = (ready.api as {
        Boundary: new () => { get: (area: string, cb: (r: { boundaries: string[] }) => void) => void };
      }).Boundary;
      boundaryInstance = new Boundary();
    }
    isLoading.value = true;
    boundaryInstance.get(area, (rs) => {
      isLoading.value = false;
      boundaries.value = rs.boundaries;
    });
  }

  onUnmounted(() => {
    boundaryInstance = null;
  });

  return { isLoading, boundaries, get };
}
