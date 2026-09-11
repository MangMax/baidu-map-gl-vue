/**
 * Fake BMap v4 Map（M3A2-MAP / issue #20）
 *
 * 行为依据：官方 JSAPI 4.0 `BMap.Map`（`v=4.0`）
 * - 构造参数 `new BMap.Map(idOrElement, options)`；`center` / `zoom` 也可在 options 中给出；
 * - 视野：`centerAndZoom` / `setCenter` / `setZoom` / `getCenter` / `getZoom` / `getBounds` / `getSize`；
 * - 旋转与倾斜：`setHeading` / `getHeading` / `setTilt` / `getTilt`；
 * - 交互：成对 `enable*` / `disable*` 方法（4.0 官方 API 参考里仍公开列出的运行时入口）；
 * - 投影：`pointToPixel` / `pixelToPoint`（不传 options 时按当前地图状态换算）；
 * - 资源释放：`destroy()` —— 清空 Map 自身监听器，但管不到子对象。
 *
 * 覆盖面刻意只到「Map Facet 会调用 + Capability Registry 会探测」的成员（`getViewport` 属后者：
 * `map.viewport` 能力要求 `getViewport` 与 `setViewport` 同时在位）。其余官方成员等真正有
 * Facet 或组件需要时再补，避免 Fake 先于实现膨胀；`FakeV4MapTypeId` 是例外——常量表整体镜像。
 *
 * 与 `fake-bmapgl` 一致，**刻意不复刻** SDK 的数值归一化（heading 归一、tilt 截断）：
 * 这些是真实运行时的内部行为，Fake 只记录「传进去了什么」，跨 Fake 的共享契约因此只断言
 * 不依赖归一化的取值。真实数值行为由 M3A.3（#25）的浏览器 smoke 验证。
 *
 * 容器尺寸：happy-dom 没有布局引擎（`clientWidth` 恒为 0），因此 `getSize()` 从容器**内联样式**
 * 解析，`0` 表示零尺寸容器。这与「容器零尺寸时 create 不抛错、`checkResize()` 后按新尺寸重算」
 * 的验证目标一致。
 */
import { FakeV4EventTarget, type FakeV4EventStats } from './event-target.ts'
import { FakeV4Bounds, FakeV4Pixel, FakeV4Point, FakeV4Size } from './geometry.ts'

/**
 * Fake 专用投影比例（像素/度）：以当前中心点为原点、`2 ** zoom` 线性映射。
 *
 * 不是真实墨卡托投影——只保证「往返精确」与「中心点落在容器中心」两条可断言性质，
 * 与 `fake-bmapgl` 使用同一公式，便于共享 Driver 契约在两个 Fake 上跑同一套断言。
 */
function fakePixelsPerDegree(zoom: number | null): number {
  return 2 ** (zoom ?? 12)
}

function readContainerSize(container: HTMLElement): FakeV4Size {
  const parse = (value: string): number => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return new FakeV4Size(parse(container.style.width), parse(container.style.height))
}

/** 成对 `enable*` / `disable*` 方法名 → 交互状态键（与官方方法名逐一对应）。 */
export const FAKE_V4_INTERACTIONS = [
  'dragging',
  'inertialDragging',
  'scrollWheelZoom',
  'continuousZoom',
  'resizeOnCenter',
  'doubleClickZoom',
  'keyboard',
  'pinchToZoom',
  'rotate',
  'rotateGestures',
  'tilt',
  'tiltGestures',
] as const

export type FakeV4Interaction = (typeof FAKE_V4_INTERACTIONS)[number]

export class FakeV4Map extends FakeV4EventTarget {
  container: HTMLElement
  options: Record<string, unknown>
  center: FakeV4Point | null = null
  zoom: number | null = null
  heading = 0
  tilt = 0
  mapType: string | null = null
  mapStyle: Record<string, unknown> | null = null
  /** 交互开关的当前状态（键为官方方法名派生，见 `FAKE_V4_INTERACTIONS`）。 */
  readonly interactions: Record<string, boolean> = {}
  /** `startViewAnimation` 最近一次传入的实例，供 `cancelViewAnimation` 断言。 */
  lastAnimation: unknown = null
  canceledAnimation: unknown = null
  /** `centerAndZoom` / `setHeading` / `setTilt` 最近一次传入的 options。 */
  lastViewOptions: Record<string, unknown> | null = null
  resizeCalls = 0
  destroyed = false
  readonly callLog: string[] = []

  constructor(
    container: string | HTMLElement,
    options: Record<string, unknown> = {},
    stats: FakeV4EventStats,
  ) {
    super(stats)
    this.container =
      typeof container === 'string'
        ? document.getElementById(container) ?? document.createElement('div')
        : container
    this.options = options
  }

  /* ---------------------------------------------------------------- 容器与尺寸 */

  getSize(): FakeV4Size {
    return readContainerSize(this.container)
  }

  checkResize(): void {
    this.callLog.push('checkResize')
    this.resizeCalls++
  }

  /* ------------------------------------------------------------------ 视野 */

  centerAndZoom(
    point: FakeV4Point | string,
    zoom?: number,
    options?: Record<string, unknown>,
  ): void {
    this.callLog.push('centerAndZoom')
    this.center = typeof point === 'string' ? new FakeV4Point(0, 0) : point
    if (typeof zoom === 'number') this.zoom = zoom
    this.lastViewOptions = options ?? null
  }

  setCenter(point: FakeV4Point | string, options?: Record<string, unknown>): void {
    this.callLog.push('setCenter')
    this.center = typeof point === 'string' ? new FakeV4Point(0, 0) : point
    if (options) this.lastViewOptions = options
  }

  getCenter(): FakeV4Point | null {
    return this.center
  }

  setZoom(zoom: number, options?: Record<string, unknown>): void {
    this.callLog.push('setZoom')
    this.zoom = zoom
    if (options) this.lastViewOptions = options
  }

  getZoom(): number | null {
    return this.zoom
  }

  /** 按中心点与级别推导的可视范围（空范围 = 尚未初始化，与官方 `getBounds()` 语义一致）。 */
  getBounds(): FakeV4Bounds {
    if (!this.center || this.zoom === null) return new FakeV4Bounds()
    const halfLng = 180 / 2 ** this.zoom
    const halfLat = halfLng / 2
    return new FakeV4Bounds(
      new FakeV4Point(this.center.lng - halfLng, this.center.lat - halfLat),
      new FakeV4Point(this.center.lng + halfLng, this.center.lat + halfLat),
    )
  }

  setViewport(view: FakeV4Point[] | FakeV4Point | { center?: FakeV4Point; zoom?: number }, options?: unknown): void {
    this.callLog.push('setViewport')
    void options
    if (Array.isArray(view) && view.length > 0) {
      const lngs = view.map((point) => point.lng)
      const lats = view.map((point) => point.lat)
      this.center = new FakeV4Point(
        (Math.min(...lngs) + Math.max(...lngs)) / 2,
        (Math.min(...lats) + Math.max(...lats)) / 2,
      )
      this.zoom = 12
      return
    }
    const viewport = view as { center?: FakeV4Point; zoom?: number }
    if (viewport.center) this.center = viewport.center
    if (typeof viewport.zoom === 'number') this.zoom = viewport.zoom
  }

  getViewport(view: FakeV4Point[] | FakeV4Bounds): { center: FakeV4Point; zoom: number } {
    this.callLog.push('getViewport')
    if (Array.isArray(view) && view.length > 0) {
      const lngs = view.map((point) => point.lng)
      const lats = view.map((point) => point.lat)
      return {
        center: new FakeV4Point(
          (Math.min(...lngs) + Math.max(...lngs)) / 2,
          (Math.min(...lats) + Math.max(...lats)) / 2,
        ),
        zoom: 12,
      }
    }
    const bounds = view as FakeV4Bounds
    return { center: bounds.getCenter() ?? new FakeV4Point(0, 0), zoom: 12 }
  }

  panTo(point: FakeV4Point, options?: Record<string, unknown>): void {
    this.callLog.push('panTo')
    this.center = point
    if (options) this.lastViewOptions = options
  }

  panBy(x: number, y: number, options?: Record<string, unknown>): void {
    this.callLog.push(`panBy:${x},${y}`)
    const center = this.center ?? new FakeV4Point(0, 0)
    const scale = fakePixelsPerDegree(this.zoom)
    this.center = new FakeV4Point(center.lng + x / scale, center.lat - y / scale)
    if (options) this.lastViewOptions = options
  }

  /* ------------------------------------------------------------ 旋转与倾斜 */

  setHeading(heading: number, options?: Record<string, unknown>): void {
    this.callLog.push('setHeading')
    this.heading = heading
    if (options) this.lastViewOptions = options
  }

  getHeading(): number {
    return this.heading
  }

  setTilt(tilt: number, options?: Record<string, unknown>): void {
    this.callLog.push('setTilt')
    this.tilt = tilt
    if (options) this.lastViewOptions = options
  }

  getTilt(): number {
    return this.tilt
  }

  /* ------------------------------------------------------------ 底图与样式 */

  setMapType(mapType: string): void {
    this.callLog.push(`setMapType:${String(mapType)}`)
    this.mapType = mapType
  }

  setMapStyle(config: Record<string, unknown>): void {
    this.callLog.push('setMapStyle')
    this.mapStyle = config
  }

  /* ------------------------------------------------------------------ 投影 */

  pointToPixel(point: FakeV4Point): FakeV4Pixel {
    this.callLog.push('pointToPixel')
    const size = this.getSize()
    const center = this.center ?? new FakeV4Point(0, 0)
    const scale = fakePixelsPerDegree(this.zoom)
    return new FakeV4Pixel(
      size.width / 2 + (point.lng - center.lng) * scale,
      size.height / 2 - (point.lat - center.lat) * scale,
    )
  }

  pixelToPoint(pixel: FakeV4Pixel): FakeV4Point {
    this.callLog.push('pixelToPoint')
    const size = this.getSize()
    const center = this.center ?? new FakeV4Point(0, 0)
    const scale = fakePixelsPerDegree(this.zoom)
    return new FakeV4Point(
      center.lng + (pixel.x - size.width / 2) / scale,
      center.lat - (pixel.y - size.height / 2) / scale,
    )
  }

  /* -------------------------------------------------------------- 视角动画 */

  startViewAnimation(animation: unknown): void {
    this.callLog.push('startViewAnimation')
    this.lastAnimation = animation
  }

  cancelViewAnimation(animation: unknown): void {
    this.callLog.push('cancelViewAnimation')
    this.canceledAnimation = animation
  }

  /* ---------------------------------------------------------- 交互开关（成对方法） */

  private setInteraction(name: FakeV4Interaction, enabled: boolean): void {
    this.callLog.push(`${enabled ? 'enable' : 'disable'}${name[0].toUpperCase()}${name.slice(1)}`)
    this.interactions[name] = enabled
  }

  enableDragging(): void {
    this.setInteraction('dragging', true)
  }
  disableDragging(): void {
    this.setInteraction('dragging', false)
  }
  enableInertialDragging(): void {
    this.setInteraction('inertialDragging', true)
  }
  disableInertialDragging(): void {
    this.setInteraction('inertialDragging', false)
  }
  enableScrollWheelZoom(): void {
    this.setInteraction('scrollWheelZoom', true)
  }
  disableScrollWheelZoom(): void {
    this.setInteraction('scrollWheelZoom', false)
  }
  enableContinuousZoom(): void {
    this.setInteraction('continuousZoom', true)
  }
  disableContinuousZoom(): void {
    this.setInteraction('continuousZoom', false)
  }
  enableResizeOnCenter(): void {
    this.setInteraction('resizeOnCenter', true)
  }
  disableResizeOnCenter(): void {
    this.setInteraction('resizeOnCenter', false)
  }
  enableDoubleClickZoom(): void {
    this.setInteraction('doubleClickZoom', true)
  }
  disableDoubleClickZoom(): void {
    this.setInteraction('doubleClickZoom', false)
  }
  enableKeyboard(): void {
    this.setInteraction('keyboard', true)
  }
  disableKeyboard(): void {
    this.setInteraction('keyboard', false)
  }
  enablePinchToZoom(): void {
    this.setInteraction('pinchToZoom', true)
  }
  disablePinchToZoom(): void {
    this.setInteraction('pinchToZoom', false)
  }
  enableRotate(): void {
    this.setInteraction('rotate', true)
  }
  disableRotate(): void {
    this.setInteraction('rotate', false)
  }
  enableRotateGestures(): void {
    this.setInteraction('rotateGestures', true)
  }
  disableRotateGestures(): void {
    this.setInteraction('rotateGestures', false)
  }
  enableTilt(): void {
    this.setInteraction('tilt', true)
  }
  disableTilt(): void {
    this.setInteraction('tilt', false)
  }
  enableTiltGestures(): void {
    this.setInteraction('tiltGestures', true)
  }
  disableTiltGestures(): void {
    this.setInteraction('tiltGestures', false)
  }

  /* ------------------------------------------------------------------ 释放 */

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.callLog.push('destroy')
    // 官方语义：destroy 会清空 Map 自身残留监听器，但管不到子对象
    this.clearAllListeners()
  }
}

/**
 * Fake 版 `BMap.MapTypeId`（官方 4.0.4 在类型包里以静态成员声明地图类型常量）。
 *
 * 值为常量**名**，与 `fake-bmapgl` 对 `BMAP_*_MAP` 的取值口径一致；真实运行时的常量值由
 * #25 的浏览器 smoke 核对。
 */
export class FakeV4MapTypeId {
  static readonly BMAP_NORMAL_MAP = 'BMAP_NORMAL_MAP'
  static readonly BMAP_SATELLITE_MAP = 'BMAP_SATELLITE_MAP'
  static readonly BMAP_HYBRID_MAP = 'BMAP_HYBRID_MAP'
  static readonly BMAP_EARTH_MAP = 'BMAP_EARTH_MAP'
  static readonly BMAP_NONE_MAP = 'BMAP_NONE_MAP'
}
