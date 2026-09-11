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
    // 释放顺序（M3A2-CONTROLS-LAYERS / issue #22 实施步骤 4）：**先解绑业务事件**，
    // 再由 Map 移除 SDK 资源。`BDistrictLayer` 在 addToMap 里经 `scope.add` 绑定了
    // click/mouseover/mouseout；先 dispose 才能保证 SDK 在 removeLayer 期间派发的事件
    // 不会打到正在拆解的业务回调上（`adapter.remove` 不读 scope，提前 dispose 安全）。
    scope.dispose();
    if (current && readyCtx) adapter.remove(current, readyCtx);
    resource.value = null;
  });

  return { resource };
}
