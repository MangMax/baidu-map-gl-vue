/**
 * Fake BMap v4 EventTarget
 *
 * 与官方 JSAPI 4.0 一致的事件语义：
 * - 监听器按**函数身份**判等，同一个函数对象重复 `addEventListener` 只保留一份；
 * - `removeEventListener` 必须传入 `addEventListener` 时的同一个函数对象，否则不生效
 *   （这正是「用新匿名函数解绑一定失败」的 runtime 依据）。
 *
 * 计数落在 `FakeV4Diagnostics`（`./diagnostics.ts`）上：监听器是**泄漏门禁**的一项
 * （`leaks.listeners`），调用次数是**活动口径**（`activity.listenCalls` / `unlistenCalls`）。
 * 两个口径的分工见 diagnostics 的模块注释——「handler 更新不重绑」断言前者，
 * 「dispose 后归零」断言后者。
 *
 * M3A3（#24）之前这里的计数类叫 `FakeV4EventStats`；诊断扩到资源/定时器/回调之后，
 * 名字与职责不再相符，因此统一收进 `FakeV4Diagnostics`。
 */
import type { FakeV4Diagnostics } from "./diagnostics.ts";

export class FakeV4EventTarget {
  protected readonly listeners = new Map<string, Set<(event: any) => void>>();

  constructor(protected readonly stats: FakeV4Diagnostics) {}

  addEventListener(type: string, listener: (event: any) => void): void {
    this.stats.listenCalls++;
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    if (set.has(listener)) return;
    set.add(listener);
    this.stats.liveListeners++;
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    const set = this.listeners.get(type);
    if (!set || !set.delete(listener)) return;
    this.stats.unlistenCalls++;
    this.stats.liveListeners--;
    if (set.size === 0) this.listeners.delete(type);
  }

  /** 测试辅助：派发事件（真实 SDK 由地图内部派发）。 */
  emit(type: string, payload: Record<string, unknown> = {}): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) listener({ type, ...payload });
  }

  /** 测试辅助：当前监听器数（不带参数则统计全部类型）。 */
  getListenerCount(type?: string): number {
    if (type !== undefined) return this.listeners.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  /** 测试辅助：当前已绑定的监听器类型。 */
  getListenerTypes(): string[] {
    return [...this.listeners.keys()];
  }

  /** 模拟 `map.destroy()`：清空自身残留监听器（子对象监听器不受影响）。 */
  clearAllListeners(): void {
    for (const set of this.listeners.values()) {
      this.stats.liveListeners -= set.size;
    }
    this.listeners.clear();
  }
}
