/**
 * useOverlayResource
 *
 * 通用 Overlay 生命周期 composable:
 * - map ready 后创建 SDK 实例
 * - `addToMap` 添加覆盖物并注册进 OverlayRegistry
 * - 通过 `createWatch` 注册字段级 watcher(SDK 就绪后进入 scope)
 * - 卸载时移除 + 销毁 + 释放全部资源
 * - SDK 就绪前卸载:不创建资源(竞态安全)
 */
import { onMounted, onUnmounted, shallowRef, markRaw, type ShallowRef } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { BMapError } from "../../core/errors/BMapError";
import type { MapReadyContext } from "../../core/context/types";

export interface OverlayLifecycle<Props, Resource> {
  /** 创建 SDK 实例(可为同步或异步) */
  create(
    context: MapReadyContext,
    props: Readonly<Props>,
    scope: ResourceScope,
  ): Resource | Promise<Resource>;
  /** 创建后添加到地图(用 true 语义 addOverlay),并注册 overlay */
  addToMap(
    resource: Resource,
    context: MapReadyContext,
    props: Readonly<Props>,
    scope: ResourceScope,
  ): void;
  /**
   * 在 setup 阶段同步注册的 watcher(保证响应式)。
   * 通过 getResource() 读取当前实例(可能为 null),getCtx() 读取 ready 上下文。
   * 全部 watcher 应返回停止函数或注册到该 composable 的 scope。
   */
  createWatchers?(
    getCtx: () => MapReadyContext | null,
    getResource: () => Resource | null,
    props: Readonly<Props>,
    addDisposer: (d: () => void) => void,
  ): void;
  /** 从地图移除并销毁 SDK 实例 */
  remove(resource: Resource, context: MapReadyContext): void;
}

export interface UseOverlayResourceResult<Resource> {
  resource: ShallowRef<Resource | null>;
  ready: Promise<MapReadyContext>;
  /** 用当前 props 重建覆盖物(适合 SDK 不可变对象,如 MapMask path 更新) */
  rebuild: () => Promise<void>;
}

export function useOverlayResource<Props, Resource>(
  props: Readonly<Props>,
  lifecycle: OverlayLifecycle<Props, Resource>,
  overlayType = "overlay",
): UseOverlayResourceResult<Resource> {
  const ctx = useRequiredMapContext();
  const componentScope = new ResourceScope();
  let instanceScope: ResourceScope | null = null;
  const resource = shallowRef<Resource | null>(null);
  let readyCtx: MapReadyContext | null = null;
  let disposed = false;
  let createToken = 0;

  const ensureInstanceScope = () => {
    if (!instanceScope || instanceScope.isDisposed) {
      instanceScope = componentScope.fork("overlay-instance");
    }
    return instanceScope;
  };

  // 在 setup 同步注册响应式 watcher(避免 async 续体丢失响应式)
  // watcher 本体进入 componentScope（跨 rebuild 存活），通过 getResource 读取当前实例
  lifecycle.createWatchers?.(
    () => readyCtx,
    () => resource.value,
    props,
    (d) => componentScope.add(d),
  );

  onMounted(async () => {
    const token = ++createToken;
    try {
      const ready = await ctx.whenReady(componentScope.signal);
      if (componentScope.isDisposed || disposed || token !== createToken) return;
      readyCtx = ready;

      // 每个实例独立 child scope；create/addToMap 的监听与资源进入 instanceScope
      const scope = ensureInstanceScope();
      const created = await lifecycle.create(ready, props, scope);
      if (scope.isDisposed || componentScope.isDisposed || disposed || token !== createToken) {
        lifecycle.remove(created, ready);
        return;
      }
      const raw: Resource = created;
      resource.value = markRaw(raw as object) as Resource;
      lifecycle.addToMap(created, ready, props, scope);
    } catch (error) {
      if (!componentScope.signal.aborted && !disposed) {
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
    if (current && readyCtx) {
      try {
        lifecycle.remove(current, readyCtx);
      } catch {
        // SDK teardown can fail after the map has already been disposed.
      }
    }
    resource.value = null;
    instanceScope?.dispose();
    instanceScope = null;
    componentScope.dispose();
  });

  /** 用当前 props 重建覆盖物(remove 旧 + create 新 + add) */
  const rebuild = async () => {
    if (!readyCtx || disposed) return;
    const ready = readyCtx;
    const old = resource.value;
    if (old) {
      try {
        lifecycle.remove(old, ready);
      } catch {
        /* 忽略移除错误 */
      }
      resource.value = null;
    }
    // 废弃旧 instanceScope，重 fork 新实例 scope，避免复用同一 scope 堆积 listener
    instanceScope?.dispose();
    instanceScope = componentScope.fork("overlay-instance");
    const scope = instanceScope;
    const token = ++createToken;
    const created = await lifecycle.create(ready, props, scope);
    if (scope.isDisposed || componentScope.isDisposed || disposed || token !== createToken) {
      try {
        lifecycle.remove(created, ready);
      } catch {
        /* 忽略清理错误 */
      }
      return;
    }
    resource.value = markRaw(created as object) as Resource;
    lifecycle.addToMap(created, ready, props, scope);
  };

  return {
    resource,
    ready: ctx.whenReady(componentScope.signal),
    rebuild,
  };
}

/** 通用的 overlay 移除 helper:经 Driver 从地图 removeOverlay */
export function removeOverlay(resource: unknown, ctx: MapReadyContext) {
  ctx.client.driver.overlays.remove({ kind: "map", handle: ctx.map }, resource as never);
}
