/**
 * OverlayRegistry
 *
 * 每地图实例的覆盖物注册表:
 * - 注册/注销 Overlay
 * - 按 type 查询
 * - runtime dispose 时逆序清理
 * - 支持 InfoWindow 单实例策略
 * - 处理 clearOverlays 后 registry 同步
 *
 * registration 自带 dispose，不再维护无界 disposer 历史数组。
 */
import { ResourceScope } from "../lifecycle/ResourceScope";

export interface OverlayRecord<Resource = unknown> {
  readonly id: symbol;
  readonly type: string;
  readonly instance: Resource;
  readonly owner: ResourceScope;
}

export interface ResourceRegistration<Resource = unknown> {
  readonly id: symbol;
  readonly type: string;
  readonly resource: Resource;
  readonly disposed: boolean;
  dispose(): void;
}

export interface OverlayRegistry {
  register<Resource>(type: string, instance: Resource, owner?: ResourceScope): symbol;
  /** 新 API：返回自带 dispose 的 registration，避免历史闭包堆积 */
  registerResource<Resource>(input: {
    type: string;
    resource: Resource;
    scope: ResourceScope;
    remove: (resource: Resource) => void;
  }): ResourceRegistration<Resource>;
  unregister(id: symbol): void;
  get(id: symbol): OverlayRecord | undefined;
  getByType<Resource = unknown>(type: string): OverlayRecord<Resource>[];
  /** 同步 registry 以反映 map.clearOverlays 清除的全部 overlay */
  clearAll(): void;
  dispose(): void;
  get size(): number;
}

export function createOverlayRegistry(): OverlayRegistry {
  const records = new Map<symbol, OverlayRecord>();

  const registry: OverlayRegistry = {
    register(type, instance, owner) {
      const id = Symbol("overlay");
      const scope = owner ?? new ResourceScope();
      const rec: OverlayRecord = { id, type, instance, owner: scope };
      records.set(id, rec);
      // owner 释放时自动摘除记录；detach 经 scope.remove 在 unregister 时摘除，
      // 不维护无界历史数组。
      const detach = () => {
        records.delete(id);
      };
      scope.add(detach);
      // 将 detach 句柄挂到记录上，供 unregister 时摘除
      (rec as { __detach?: () => void }).__detach = detach;
      return id;
    },
    registerResource<Resource>(input: {
      type: string;
      resource: Resource;
      scope: ResourceScope;
      remove: (resource: Resource) => void;
    }): ResourceRegistration<Resource> {
      const id = Symbol("overlay");
      const rec: OverlayRecord<Resource> = {
        id,
        type: input.type,
        instance: input.resource,
        owner: input.scope,
      };
      records.set(id, rec);
      let disposed = false;
      // scope 释放时自动摘除（不调用 SDK remove，SDK remove 由调用方 dispose 显式执行）
      const detach = () => {
        records.delete(id);
      };
      input.scope.add(detach);
      const registration: ResourceRegistration<Resource> = {
        id,
        type: input.type,
        resource: input.resource,
        get disposed() {
          return disposed;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          try {
            input.remove(input.resource);
          } finally {
            records.delete(id);
            input.scope.remove(detach);
          }
        },
      };
      return registration;
    },
    unregister(id) {
      const rec = records.get(id);
      if (rec) {
        records.delete(id);
        // 从 owner 摘除 detach，避免 owner disposers 堆积
        const detach = (rec as { __detach?: () => void }).__detach;
        if (detach) rec.owner.remove(detach);
      }
    },
    get(id) {
      return records.get(id);
    },
    getByType(type) {
      return [...records.values()].filter((r) => r.type === type) as OverlayRecord<any>[];
    },
    clearAll() {
      // 模拟 map.clearOverlays:移除全部
      for (const rec of [...records.values()]) {
        records.delete(rec.id);
      }
    },
    dispose() {
      for (const rec of [...records.values()].reverse()) {
        records.delete(rec.id);
        try {
          rec.owner.dispose();
        } catch {
          // 忽略单个 owner 释放错误，继续释放其余
        }
      }
      records.clear();
    },
    get size() {
      return records.size;
    },
  };
  return registry;
}
