/**
 * 生命周期 Inspector
 *
 * 统计当前 JS 运行时中:
 * - Map / Overlay / Control 数量(fake BMapGL 层面)
 * - DOM EventTarget listener 数
 * - ResizeObserver / MutationObserver / IntersectionObserver 数
 * - RAF / timer 数
 * - SDK 加载 pending 数
 *
 * 在测试 fixture 中用它断言"100 次挂载/卸载后资源回到基线"。
 */
import { createFakeBMapGl, FakeBMapGlApi } from '../fake-bmapgl'

export interface LifecycleSnapshot {
  maps: number
  overlays: number
  controls: number
  sdkListeners: number
  observers: number
  animationFrames: number
  timers: number
  pendingLoads: number
}

export class LifecycleInspector {
  private fakeApi: FakeBMapGlApi | null = null

  attachFakeApi(api: FakeBMapGlApi) {
    this.fakeApi = api
  }

  private countObservers(): number {
    // 从 window 上注册的 Observer 计数是困难的;fake 环境里我们用一个可控计数器
    // 真实浏览器环境通过 window.__BMAP_OBSERVER_COUNT__ 计数(由 v3 运行时注入)
    const w = window as unknown as { __BMAP_OBSERVER_COUNT__?: number }
    return w.__BMAP_OBSERVER_COUNT__ ?? 0
  }

  private countRaf(): number {
    const w = window as unknown as { __BMAP_RAF_COUNT__?: number }
    return w.__BMAP_RAF_COUNT__ ?? 0
  }

  private countTimers(): number {
    const w = window as unknown as { __BMAP_TIMER_COUNT__?: number }
    return w.__BMAP_TIMER_COUNT__ ?? 0
  }

  private countPendingLoads(): number {
    const w = window as unknown as { __BMAP_PENDING_LOADS__?: number }
    return w.__BMAP_PENDING_LOADS__ ?? 0
  }

  snapshot(): LifecycleSnapshot {
    const stats = this.fakeApi?.stats
    return {
      maps: stats?.maps ?? 0,
      overlays: stats ? stats.overlaysCreated - stats.overlaysRemoved : 0,
      controls: stats ? stats.controlsCreated - stats.controlsRemoved : 0,
      sdkListeners: stats?.listeners ?? 0,
      observers: this.countObservers(),
      animationFrames: this.countRaf(),
      timers: this.countTimers(),
      pendingLoads: this.countPendingLoads(),
    }
  }

  assertZeroLeaks() {
    const s = this.snapshot()
    const leaked = Object.entries(s).filter(([, v]) => v !== 0)
    if (leaked.length > 0) {
      throw new Error(
        `[lifecycle-inspector] leaked resources: ${leaked.map(([k, v]) => `${k}=${v}`).join(', ')}`,
      )
    }
    return s
  }
}

let inspector: LifecycleInspector | null = null
const fake = createFakeBMapGl()

export function getLifecycleInspector(): LifecycleInspector {
  if (!inspector) {
    inspector = new LifecycleInspector()
    inspector.attachFakeApi(fake)
  }
  return inspector
}

export function getFakeBMapGl(): FakeBMapGlApi {
  return fake
}

export function resetLifecycleState() {
  fake.stats.reset()
  fake.createdMaps.length = 0
  fake.createdContextMenus.length = 0
}

/** 测试环境里用这段代码注册 window 计数器(由 v3 运行时调用) */
export function registerRuntimeCounters() {
  const w = window as unknown as {
    __BMAP_OBSERVER_COUNT__?: number
    __BMAP_RAF_COUNT__?: number
    __BMAP_TIMER_COUNT__?: number
    __BMAP_PENDING_LOADS__?: number
  }
  w.__BMAP_OBSERVER_COUNT__ = 0
  w.__BMAP_RAF_COUNT__ = 0
  w.__BMAP_TIMER_COUNT__ = 0
  w.__BMAP_PENDING_LOADS__ = 0
}
