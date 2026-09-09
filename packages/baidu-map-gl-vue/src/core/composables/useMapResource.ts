/**
 * useMapResource
 *
 * 通用 SDK 资源适配器:管理 create/update/destroy。
 * 处理 SDK ready 异步 + 组件卸载竞态:
 * - 组件在 SDK 就绪前卸载:不创建 SDK 资源
 * - 创建后探测到已卸载:立即销毁
 * - create sequence token 防旧 Promise 覆盖新实例
 */
import { onMounted, onScopeDispose, shallowRef, markRaw, type ShallowRef } from "vue";
import { ResourceScope } from "../lifecycle/ResourceScope";
import type { MapRuntime } from "../runtime/MapRuntime";
import { BMapError } from "../errors/BMapError";
import type { MapReadyContext } from "../context/types";

export interface SdkResourceAdapter<Props, Resource> {
  create(
    context: MapReadyContext,
    props: Readonly<Props>,
    scope: ResourceScope,
  ): Resource | Promise<Resource>;
  connect?(
    resource: Resource,
    context: MapReadyContext,
    props: Readonly<Props>,
    scope: ResourceScope,
  ): void;
  update?(
    resource: Resource,
    previous: Readonly<Props>,
    current: Readonly<Props>,
    context: MapReadyContext,
  ): void;
  destroy(resource: Resource, context: MapReadyContext): void;
}

export interface UseMapResourceResult<Resource> {
  resource: ShallowRef<Resource | null>;
  whenReady: () => Promise<MapReadyContext>;
}

export function useMapResource<Props, Resource>(
  runtime: MapRuntime,
  props: Readonly<Props>,
  adapter: SdkResourceAdapter<Props, Resource>,
): UseMapResourceResult<Resource> {
  const scope = new ResourceScope();
  const resource = shallowRef<Resource | null>(null);
  let createToken = 0;
  // 保存当前 ready context,供 dispose 时销毁
  let readyCtx: MapReadyContext | null = null;

  onScopeDispose(() => {
    const current = resource.value;
    if (current && readyCtx) {
      adapter.destroy(current, readyCtx);
    }
    resource.value = null;
    scope.dispose();
  });

  onMounted(async () => {
    const token = ++createToken;
    try {
      const ready = await runtime.whenReady(scope.signal);
      if (scope.isDisposed || token !== createToken) return;
      readyCtx = ready;

      const created = await adapter.create(ready, props, scope);
      if (scope.isDisposed || token !== createToken) {
        adapter.destroy(created, ready);
        return;
      }
      const raw: Resource = created;
      resource.value = markRaw(raw as object) as Resource;
      adapter.connect?.(created, ready, props, scope);
    } catch (error) {
      if (!scope.signal.aborted) {
        runtime.events.emit("resource:error", {
          error:
            error instanceof BMapError
              ? error
              : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(error), { cause: error }),
          component: (props as any)?.__componentName,
        });
      }
    }
  });

  return {
    resource,
    whenReady: () => runtime.whenReady(scope.signal),
  };
}
