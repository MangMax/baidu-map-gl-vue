/**
 * M0-03: FakeEventTarget
 *
 * 可统计 add/remove 事件的 SDK EventTarget,用于组件事件绑定行为测试。
 */
export class FakeEventTarget<EventMap extends Record<string, unknown> = Record<string, unknown>> {
  protected listeners = new Map<keyof EventMap, Set<(event: any) => void>>()
  /** 可选:add/remove 时回调(用于 stats 计数) */
  protected onListenerChange?: (delta: 1 | -1) => void

  setListenerCounter(callback: (delta: 1 | -1) => void) {
    this.onListenerChange = callback
  }

  addEventListener<K extends keyof EventMap>(type: K, listener: (event: EventMap[K]) => void): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    if (set.has(listener as (event: any) => void)) return
    set.add(listener as (event: any) => void)
    this.onListenerChange?.(1)
  }

  removeEventListener<K extends keyof EventMap>(type: K, listener: (event: EventMap[K]) => void): void {
    const set = this.listeners.get(type)
    if (!set) return
    if (!set.delete(listener as (event: any) => void)) return
    this.onListenerChange?.(-1)
    if (set.size === 0) this.listeners.delete(type)
  }

  emit<K extends keyof EventMap>(type: K, event: EventMap[K]): void {
    const set = this.listeners.get(type)
    if (!set) return
    for (const listener of [...set]) {
      listener(event)
    }
  }

  getListenerCount(type?: keyof EventMap): number {
    if (type !== undefined) return this.listeners.get(type)?.size ?? 0
    let total = 0
    for (const set of this.listeners.values()) total += set.size
    return total
  }

  getListenerTypes(): (keyof EventMap)[] {
    return [...this.listeners.keys()]
  }
}
