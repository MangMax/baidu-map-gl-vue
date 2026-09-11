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
import { logger } from "../../core/logger";
import type { OverlayHandle } from "../../driver/types/handles";
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
  /**
   * 按**属性分类**应用一组更新(M3A2-OVERLAYS / #21):
   * - `mutable`: 经 `driver.overlays.setOptions` 就地更新;
   * - `recreate`: 触发**一次** `rebuild()`(构造期属性,只有重建才生效);
   * - `unsupported`/未知: 交给 `setOptions`,由 Driver 决定(告警 no-op 或走 set<Key> 逃生口)。
   *
   * 分类来自 Driver 的 `updatePolicy()`(单一事实源 `OVERLAY_DESCRIPTORS`),组件不再自行探测
   * raw SDK 成员形状。注意 `rebuild()` 以**当前 props** 重建,因此 recreate 键的调用方要先把
   * 新值写进 props。
   */
  applyOptions: (options: Record<string, unknown>) => Promise<void>;
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
  /**
   * 实例尚未挂载时到达的更新（重建在飞 / 首建未完成），在挂载后补跑一次。
   *
   * 直接丢弃会让「重建期间的更新」永久丢失，最终实例与最新 props 不一致（PR #61 评审 P2-1）。
   * 合并而不是排队成多条：同一次重建只需补一次，多次更新按 key 后写覆盖先写。
   */
  let pendingApply: Record<string, unknown> | null = null;

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
      // 首建期间到达的更新同样要补上（与 rebuild 之后一致）
      await flushPendingApply();
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
    pendingApply = null;
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
    // 重建期间到达的更新在这里补齐（否则它们已被丢弃，见 pendingApply 注释）
    await flushPendingApply();
  };

  /** 把挂载前累积的更新在**当前**实例上补跑一次；实例仍未挂载时保留待办，等下次挂载再补。 */
  const flushPendingApply = async () => {
    if (!pendingApply || !resource.value || disposed) return;
    const next = pendingApply;
    // 先清空再应用：applyOptions 内部可能再次触发 rebuild，届时不该重复消费这批更新
    pendingApply = null;
    await applyOptions(next);
  };

  /** 按属性分类应用更新: mutable 就地, recreate 重建**一次** */
  const applyOptions = async (options: Record<string, unknown>) => {
    const ready = readyCtx;
    if (!ready || disposed) return;
    const current = resource.value;
    if (!current) {
      // 重建在飞 / 首建未完成：合并待应用更新，等实例挂载后由 flushPendingApply 补跑。
      // 这里**不能**直接返回，否则这次更新会永久丢失（PR #61 评审 P2-1）。
      pendingApply = { ...(pendingApply ?? {}), ...options };
      return;
    }
    const overlays = ready.client.driver.overlays;
    const inPlace: Record<string, unknown> = {};
    let needsRebuild = false;
    for (const [key, value] of Object.entries(options)) {
      if (overlays.updatePolicy(current as OverlayHandle, key) === "recreate") {
        needsRebuild = true;
        continue;
      }
      inPlace[key] = value;
    }
    if (Object.keys(inPlace).length > 0) {
      try {
        overlays.setOptions(current as OverlayHandle, inPlace);
      } catch (error) {
        // 不静默吞：字段级更新失败时仍要推进下面的重建判定，但必须留下可观测的痕迹
        logger.warn(
          `useOverlayResource.applyOptions: 字段级更新失败（后续仍会按分类判断是否重建）: ${
            (error as Error)?.message ?? String(error)
          }`,
        );
      }
    }
    if (needsRebuild) await rebuild();
  };

  return {
    resource,
    ready: ctx.whenReady(componentScope.signal),
    rebuild,
    applyOptions,
  };
}

/** 通用的 overlay 移除 helper:经 Driver 从地图 removeOverlay */
export function removeOverlay(resource: unknown, ctx: MapReadyContext) {
  ctx.client.driver.overlays.remove({ kind: "map", handle: ctx.map }, resource as OverlayHandle);
}
