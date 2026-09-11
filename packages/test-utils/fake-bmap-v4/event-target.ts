/**
 * Fake BMap v4 EventTarget
 *
 * 与官方 JSAPI 4.0 一致的事件语义：
 * - 监听器按**函数身份**判等，同一个函数对象重复 `addEventListener` 只保留一份；
 * - `removeEventListener` 必须传入 `addEventListener` 时的同一个函数对象，否则不生效
 *   （这正是「用新匿名函数解绑一定失败」的 runtime 依据）。
 *
 * 统计口径刻意分成两类，供不同断言使用：
 * - `listenCalls` / `unlistenCalls`：方法**被调用**的次数（含无效调用与重复绑定），
 *   用于断言「handler 更新不重绑」——同一个 target+type 上不应出现第二次 add 调用；
 * - `liveListeners`：当前**存活**的监听器数，用于断言 dispose 后归零。
 */
export class FakeV4EventStats {
  /** `addEventListener` 被调用次数（含重复绑定同一函数） */
  listenCalls = 0
  /** `removeEventListener` 成功移除的次数 */
  unlistenCalls = 0
  /** 当前存活的监听器数（全部 target 合计） */
  liveListeners = 0

  reset(): void {
    this.listenCalls = 0
    this.unlistenCalls = 0
    this.liveListeners = 0
  }
}

export class FakeV4EventTarget {
  protected readonly listeners = new Map<string, Set<(event: any) => void>>()

  constructor(protected readonly stats: FakeV4EventStats) {}

  addEventListener(type: string, listener: (event: any) => void): void {
    this.stats.listenCalls++
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    if (set.has(listener)) return
    set.add(listener)
    this.stats.liveListeners++
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    const set = this.listeners.get(type)
    if (!set || !set.delete(listener)) return
    this.stats.unlistenCalls++
    this.stats.liveListeners--
    if (set.size === 0) this.listeners.delete(type)
  }

  /** 测试辅助：派发事件（真实 SDK 由地图内部派发） */
  emit(type: string, payload: Record<string, unknown> = {}): void {
    const set = this.listeners.get(type)
    if (!set) return
    for (const listener of [...set]) listener({ type, ...payload })
  }

  getListenerCount(type?: string): number {
    if (type !== undefined) return this.listeners.get(type)?.size ?? 0
    let total = 0
    for (const set of this.listeners.values()) total += set.size
    return total
  }

  getListenerTypes(): string[] {
    return [...this.listeners.keys()]
  }

  /** 模拟 `map.destroy()`：清空自身残留监听器（子对象监听器不受影响） */
  clearAllListeners(): void {
    for (const set of this.listeners.values()) {
      this.stats.liveListeners -= set.size
    }
    this.listeners.clear()
  }
}
