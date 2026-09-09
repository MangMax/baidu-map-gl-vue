/**
 * useLayerResource
 *
 * Layer 类组件统一处理:
 * - map.addLayer/removeLayer(及 district 等 addDistrictLayer 变体)
 * - add/remove 幂等
 * - 卸载时移除 + 释放
 */
import { onMounted, onUnmounted, shallowRef, markRaw, type ShallowRef } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { BMapError } from "../../core/errors/BMapError";
import type { MapReadyContext } from "../../core/context/types";

export interface LayerResourceAdapter<Props, Resource> {
  create(context: MapReadyContext, props: Readonly<Props>, scope: ResourceScope): Resource;
  addToMap(resource: Resource, context: MapReadyContext): void;
  remove(resource: Resource, context: MapReadyContext): void;
  createWatchers?(
    resource: Resource,
    context: MapReadyContext,
    props: Readonly<Props>,
    scope: ResourceScope,
  ): void;
}

export interface UseLayerResourceResult<Resource> {
  resource: ShallowRef<Resource | null>;
}
export function useLayerResource<Props, Resource>(
  props: Readonly<Props>,
  adapter: LayerResourceAdapter<Props, Resource>,
): UseLayerResourceResult<Resource> {
  const ctx = useRequiredMapContext();
  const scope = new ResourceScope();
  const resource = shallowRef<Resource | null>(null);
  let readyCtx: MapReadyContext | null = null;
  let disposed = false;

  onMounted(async () => {
    try {
      const ready = await ctx.whenReady(scope.signal);
      if (scope.isDisposed || disposed) return;
      readyCtx = ready;
      const created = adapter.create(ready, props, scope);
      if (scope.isDisposed || disposed) {
        adapter.remove(created, ready);
        return;
      }
      const raw: Resource = created;
      resource.value = markRaw(raw as object) as Resource;
      adapter.addToMap(created, ready);
      adapter.createWatchers?.(created, ready, props, scope);
    } catch (error) {
      if (!scope.signal.aborted && !disposed) {
        ctx.events.emit("resource:error", {
          error:
            error instanceof BMapError
              ? error
              : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(error), { cause: error }),
          component: (props as any)?.__componentName,
        });
      }
    }
  });

  onUnmounted(() => {
    disposed = true;
    const current = resource.value;
    if (current && readyCtx) adapter.remove(current, readyCtx);
    resource.value = null;
    scope.dispose();
  });

  return { resource };
}
