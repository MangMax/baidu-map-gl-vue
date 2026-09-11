/**
 * v4 EventDriver（M3A2-02 / issue #19）
 *
 * 与 `webgl-v1` 的直通实现相比，这里承担三件事：
 *
 * 1. **可释放且可重复调用的 disposer**：每次订阅都返回 disposer，重复调用安全（幂等）；
 * 2. **同 target+type 只有一个 raw listener**：官方 API 按函数身份解绑，而组件每次重渲染
 *    都会传入新的 handler，若每次都 `addEventListener` 就会持续泄漏。这里把订阅者聚合成
 *    一个稳定的 raw 包装函数——handler 更新/追加只改订阅集合，**不重绑**；最后一个订阅
 *    释放时才 `removeEventListener`，监听器计数回到零；
 * 3. **边界归一化 + 所有权校验**：派发前把 raw event 归一化为 `DriverEvent`，并拒绝不属于
 *    本 Client 的句柄（跨地图操作必须在这里失败，而不是在 SDK 里产生难定位的异常）。
 *
 * 生命周期：订阅集合为空时立刻删除 `groups` 里的 target/type 条目，驱动不会因为
 * 「曾经订阅过某张地图」而长期持有已销毁的 raw 对象。
 *
 * 语义细节：订阅按**函数身份**去重（与官方 `addEventListener` 一致），因此同一个函数
 * 重复订阅只算一个订阅者。
 */
import { logger } from "../../core/logger";
import { normalizeDriverEvent } from "../normalize";
import type { DriverEvent, EventDriver } from "../types/events";
import type { GeometryDriver } from "../types/geometry";
import type { SdkHandle } from "../types/handles";
import { readNamespaceMember } from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

type RawListener = (event: unknown) => void;
type RawMethod = (type: string, listener: RawListener) => void;
type TypedListener = (event: DriverEvent) => void;

interface SubscriptionGroup {
  /** 真正注册到 SDK 上的稳定包装函数：订阅集合变化时不重建。 */
  readonly raw: RawListener;
  readonly listeners: Set<TypedListener>;
}

export interface CreateJsapiV4EventDriverInput {
  registry: JsapiV4HandleRegistry;
  geometry: GeometryDriver;
}

function noop(): void {}

/** 幂等 disposer：重复调用只执行一次释放逻辑。 */
function createDisposer(release: () => void): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    release();
  };
}

export function createJsapiV4EventDriver(input: CreateJsapiV4EventDriverInput): EventDriver {
  const { registry, geometry } = input;

  /** target → type → 订阅组；集合为空时删除条目，不长期持有 raw 对象。 */
  const groups = new Map<object, Map<string, SubscriptionGroup>>();

  const removeGroup = (target: object, type: string, removeEventListener: RawMethod): void => {
    const byType = groups.get(target);
    const group = byType?.get(type);
    if (!byType || !group) return;
    byType.delete(type);
    if (byType.size === 0) groups.delete(target);
    removeEventListener.call(target, type, group.raw);
  };

  const createGroup = (type: string): SubscriptionGroup => {
    const group: SubscriptionGroup = {
      listeners: new Set<TypedListener>(),
      raw: (event: unknown) => {
        const payload = normalizeDriverEvent(type, event, geometry);
        // 复制一份再遍历：监听器内部 dispose 不影响本轮派发
        for (const current of [...group.listeners]) current(payload);
      },
    };
    return group;
  };

  return {
    on<TEvent = unknown>(
      target: SdkHandle<string>,
      type: string,
      listener: (event: TEvent) => void,
    ): () => void {
      // 跨 Client 句柄在这里失败（BMAP_HANDLE_FOREIGN），不会被静默当成可订阅目标
      const rawTarget = registry.resolve<object>(target);
      const addEventListener = readNamespaceMember(rawTarget, "addEventListener");
      const removeEventListener = readNamespaceMember(rawTarget, "removeEventListener");
      if (typeof addEventListener !== "function" || typeof removeEventListener !== "function") {
        logger.warn(
          `EventDriver: target 缺少 addEventListener/removeEventListener，事件 "${type}" 的订阅被忽略`,
        );
        return noop;
      }
      const remove = removeEventListener as RawMethod;

      const byType = groups.get(rawTarget);
      const existing = byType?.get(type);
      if (existing) {
        // handler 更新/追加：复用同一个 raw listener，不重新绑定
        existing.listeners.add(listener as TypedListener);
        return createDisposer(() => {
          existing.listeners.delete(listener as TypedListener);
          if (existing.listeners.size === 0) removeGroup(rawTarget, type, remove);
        });
      }

      const group = createGroup(type);
      group.listeners.add(listener as TypedListener);
      // 先绑定、后登记：addEventListener 抛错时不在 groups 里留下空分组
      (addEventListener as RawMethod).call(rawTarget, type, group.raw);
      if (byType) {
        byType.set(type, group);
      } else {
        groups.set(rawTarget, new Map([[type, group]]));
      }

      return createDisposer(() => {
        group.listeners.delete(listener as TypedListener);
        if (group.listeners.size === 0) removeGroup(rawTarget, type, remove);
      });
    },
  };
}
