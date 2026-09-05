/**
 * M2-06: OverlayRegistry
 *
 * 每地图实例的覆盖物注册表:
 * - 注册/注销 Overlay
 * - 按 type 查询
 * - runtime dispose 时逆序清理
 * - 支持 InfoWindow 单实例策略
 * - 处理 clearOverlays 后 registry 同步
 */
import { ResourceScope, type Disposer } from "../lifecycle/ResourceScope";

export interface OverlayRecord<Resource = unknown> {
  readonly id: symbol;
  readonly type: string;
  readonly instance: Resource;
  readonly owner: ResourceScope;
}

export interface OverlayRegistry {
  register<Resource>(type: string, instance: Resource, owner?: ResourceScope): symbol;
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
  const disposers: Disposer[] = [];

  const registry: OverlayRegistry = {
    register(type, instance, owner) {
      const id = Symbol("overlay");
      const rec: OverlayRecord = { id, type, instance, owner: owner ?? new ResourceScope() };
      records.set(id, rec);
      const disposer = () => records.delete(id);
      disposers.push(disposer);
      if (owner) owner.add(disposer);
      return id;
    },
    unregister(id) {
      records.delete(id);
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
        rec.owner.dispose();
      }
      // 逆序执行 disposer
      for (const d of [...disposers].reverse()) d();
      disposers.length = 0;
    },
    get size() {
      return records.size;
    },
  };
  return registry;
}
