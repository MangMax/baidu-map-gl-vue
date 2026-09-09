/**
 * useControlResource
 *
 * Control 类组件统一处理:
 * - anchor
 * - offset
 * - map.addControl/removeControl
 * - 卸载时移除 + 释放
 *
 * SDK 就绪前卸载:不创建资源(竞态安全)。
 */
import { onMounted, onUnmounted, shallowRef, markRaw, type ShallowRef } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { BMapError } from "../../core/errors/BMapError";
import { toSdkXYSize } from "../utils/geometry";
import type { MapReadyContext } from "../../core/context/types";

export interface ControlResourceAdapter<Props, Resource> {
  create(context: MapReadyContext, props: Readonly<Props>, scope: ResourceScope): Resource;
  addToMap(
    resource: Resource,
    context: MapReadyContext,
    props: Readonly<Props>,
    scope: ResourceScope,
  ): void;
  /** 在 setup 阶段同步注册的响应式 watcher */
  createWatchers?(
    getCtx: () => MapReadyContext | null,
    getResource: () => Resource | null,
    props: Readonly<Props>,
    addDisposer: (d: () => void) => void,
  ): void;
  remove(resource: Resource, context: MapReadyContext): void;
}

export interface UseControlResourceResult<Resource> {
  resource: ShallowRef<Resource | null>;
}

export function useControlResource<Props, Resource>(
  props: Readonly<Props>,
  adapter: ControlResourceAdapter<Props, Resource>,
): UseControlResourceResult<Resource> {
  const ctx = useRequiredMapContext();
  const scope = new ResourceScope();
  const resource = shallowRef<Resource | null>(null);
  let readyCtx: MapReadyContext | null = null;
  let disposed = false;

  // 在 setup 同步注册响应式 watcher(避免 async 续体丢失响应式)
  adapter.createWatchers?.(
    () => readyCtx,
    () => resource.value,
    props,
    (d) => scope.add(d),
  );

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
      adapter.addToMap(created, ready, props, scope);
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

/** 构建 Control 的公共选项(anchor + offset),供 adapter.create 使用 */
export function buildControlOptions(
  anchor: string | undefined,
  offset: { x: number; y: number },
  api: unknown,
) {
  return {
    anchor,
    offset: toSdkXYSize(api, offset),
  };
}

/** 绑定 control 的 SDK 事件到 scope(卸载时释放) */
export function bindControlEvents(
  res: any,
  _api: unknown,
  scope: ResourceScope,
  events: [string, (e: any) => void][],
) {
  for (const [name, handler] of events) {
    res.addEventListener?.(name, handler);
    scope.add(() => res.removeEventListener?.(name, handler));
  }
}
