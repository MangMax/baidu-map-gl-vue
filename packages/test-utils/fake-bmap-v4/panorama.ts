/**
 * Fake BMap v4 全景替身（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 覆盖面只到「Panorama Facet 会调用 + 契约会断言」的成员：查看器的生命周期与视角、
 * 数据检索的重载（`getPanoramaById` / `getPanoramaByLocation(point)` /
 * `getPanoramaByLocation(point, radius)`）。
 *
 * 两条刻意建模的边界：
 * - **重载必须可区分**：`getPanoramaByLocation` 有「带半径」与「不带半径」两种调用，
 *   Fake 把实参个数记进 `callLog`，否则「省略半径」与「传 undefined」这两种写法在测试里
 *   长得一样——而真实 SDK 上它们是不同的重载。
 * - **`destroy()` 重复调用不保证安全**：Fake 记录调用次数但不做幂等，让「Driver 自己记账」
 *   这条设计可断言（重复 `destroy(viewer)` 时 SDK 侧计数必须仍是 1）。
 */
import type { FakeV4Diagnostics } from './diagnostics.ts'
import { FakeV4EventTarget } from './event-target.ts'
import { FakeV4CallbackQueue } from './services.ts'

export class FakeV4Panorama extends FakeV4EventTarget {
  readonly callLog: string[] = []
  readonly container: string | HTMLElement
  options: Record<string, unknown>
  visible = true
  zoom = 1
  pov: Record<string, unknown> = { heading: 0, pitch: 0 }
  position: { lng: number; lat: number } | null = null
  destroyCalls = 0
  overlays: unknown[] = []
  /**
   * 测试故障注入：让**下一次** `destroy` 抛错。
   *
   * 真实 4.0 在**未加载场景**的实例上 `destroy()` 会抛
   * `TypeError: Cannot read properties of undefined (reading 'START')`（见 ADR 的 smoke 记录），
   * Fake 把这条故障路径建模出来，才能断言「失败不记账、可以重试」。
   */
  failNextDestroy: Error | null = null
  /** 测试重入：`destroy()` 一进来就调用（业务可能在销毁回调里再次 destroy 同一个实例）。 */
  onDestroy: (() => void) | null = null

  constructor(
    container: string | HTMLElement,
    options: Record<string, unknown> = {},
    stats: FakeV4Diagnostics,
  ) {
    super(stats)
    this.container = container
    this.options = options
    this.stats.resourceCreated('panorama')
  }

  setPosition(position: { lng: number; lat: number }): void {
    this.callLog.push('setPosition')
    this.position = position
  }

  setPov(pov: Record<string, unknown>, options?: { animation?: boolean }): void {
    this.callLog.push(`setPov:${options?.animation === true ? 'animated' : 'instant'}`)
    this.pov = { ...this.pov, ...pov }
  }

  setZoom(zoom: number, options?: { noAnimation?: boolean }): void {
    this.callLog.push(`setZoom:${options?.noAnimation === true ? 'noAnimation' : 'animated'}`)
    this.zoom = zoom
  }

  getZoom(): number {
    return this.zoom
  }

  getPosition(): { lng: number; lat: number } | null {
    return this.position
  }

  getPov(): Record<string, unknown> {
    return this.pov
  }

  show(): void {
    this.callLog.push('show')
    this.visible = true
  }

  hide(): void {
    this.callLog.push('hide')
    this.visible = false
  }

  getVisible(): boolean {
    return this.visible
  }

  setOptions(options: Record<string, unknown>): void {
    this.callLog.push('setOptions')
    this.options = { ...this.options, ...options }
  }

  addOverlay(overlay: unknown): void {
    this.callLog.push('addOverlay')
    this.overlays.push(overlay)
  }

  removeOverlay(overlay: unknown): void {
    this.callLog.push('removeOverlay')
    const index = this.overlays.indexOf(overlay)
    if (index >= 0) this.overlays.splice(index, 1)
  }

  clearOverlays(): void {
    this.callLog.push('clearOverlays')
    this.overlays = []
  }

  destroy(): void {
    this.callLog.push('destroy')
    this.onDestroy?.()
    if (this.failNextDestroy) {
      const error = this.failNextDestroy
      this.failNextDestroy = null
      throw error
    }
    this.destroyCalls += 1
    // 失败路径**不**销账：诊断因此能表达「销毁没成功、账还挂着、可以重试」
    this.stats.resourceReleased('panorama')
  }
}

export class FakeV4PanoramaService {
  readonly callLog: string[] = []
  readonly queue: FakeV4CallbackQueue
  /** `getPanoramaById` 的回包；`null` = 查不到 */
  byId: Record<string, unknown> | null = {
    id: 'pano-1',
    description: '天安门全景',
    position: { lng: 116.404, lat: 39.915 },
  }
  /** `getPanoramaByLocation` 的回包；`null` = 查不到 */
  byLocation: Record<string, unknown> | null = {
    id: 'pano-2',
    description: '附近全景',
    position: { lng: 116.41, lat: 39.92 },
  }

  /** `diagnostics` 省略时回包不进诊断（独立构造检索实例的场景）。 */
  constructor(diagnostics?: FakeV4Diagnostics) {
    this.queue = new FakeV4CallbackQueue(diagnostics)
    // 全景检索与基础服务同族：官方没有销毁入口，因此只进活动口径（不进泄漏门禁）
    diagnostics?.serviceInstanceCreated()
  }

  getPanoramaById(id: string, callback: (data: Record<string, unknown> | null) => void): void {
    this.callLog.push(`getPanoramaById:${id}`)
    const value = this.byId
    this.queue.dispatch(() => callback(value))
  }

  getPanoramaByLocation(
    point: unknown,
    radiusOrCallback: number | ((data: Record<string, unknown> | null) => void),
    maybeCallback?: (data: Record<string, unknown> | null) => void,
  ): void {
    const withRadius = typeof radiusOrCallback === 'number'
    this.callLog.push(`getPanoramaByLocation:args=${withRadius ? 3 : 2}`)
    const callback = withRadius ? maybeCallback : radiusOrCallback
    const value = this.byLocation
    this.queue.dispatch(() => callback?.(value))
  }
}
