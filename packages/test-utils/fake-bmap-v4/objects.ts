/**
 * Fake BMap v4 运行对象（Map / Overlay）
 *
 * 只实现 M3A.2 基础边界（M3A2-01/02）需要的成员：事件注册与最小视图读写。
 * 完整 Map/Overlay Facet（#20 / #21）落地时在此扩展，不要另起一套 fake。
 */
import { FakeV4EventTarget, type FakeV4EventStats } from './event-target.ts'
import { FakeV4Point, FakeV4Size } from './geometry.ts'

export class FakeV4Map extends FakeV4EventTarget {
  container: HTMLElement
  options: Record<string, unknown>
  center: FakeV4Point | null = null
  zoom: number | null = null
  destroyed = false
  readonly callLog: string[] = []

  constructor(container: string | HTMLElement, options: Record<string, unknown> = {}, stats: FakeV4EventStats) {
    super(stats)
    this.container =
      typeof container === 'string'
        ? document.getElementById(container) ?? document.createElement('div')
        : container
    this.options = options
  }

  centerAndZoom(point: FakeV4Point, zoom: number): void {
    this.callLog.push('centerAndZoom')
    this.center = point
    this.zoom = zoom
  }

  setCenter(point: FakeV4Point): void {
    this.callLog.push('setCenter')
    this.center = point
  }

  getCenter(): FakeV4Point | null {
    return this.center
  }

  setZoom(zoom: number): void {
    this.callLog.push('setZoom')
    this.zoom = zoom
  }

  getZoom(): number | null {
    return this.zoom
  }

  getSize(): FakeV4Size {
    return { width: 300, height: 300 } as FakeV4Size
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.callLog.push('destroy')
    // 官方语义：destroy 会清空 Map 自身残留监听器，但管不到子对象
    this.clearAllListeners()
  }
}

export class FakeV4Overlay extends FakeV4EventTarget {
  options: Record<string, unknown>
  readonly callLog: string[] = []

  constructor(options: Record<string, unknown>, stats: FakeV4EventStats) {
    super(stats)
    this.options = options
  }
}

export class FakeV4Marker extends FakeV4Overlay {
  position: FakeV4Point

  constructor(point: FakeV4Point, options: Record<string, unknown>, stats: FakeV4EventStats) {
    super(options, stats)
    this.position = point
  }

  setPosition(point: FakeV4Point): void {
    this.callLog.push('setPosition')
    this.position = point
  }
}

export class FakeV4Polyline extends FakeV4Overlay {
  path: FakeV4Point[]

  constructor(path: FakeV4Point[], options: Record<string, unknown>, stats: FakeV4EventStats) {
    super(options, stats)
    this.path = path
  }
}

export class FakeV4Polygon extends FakeV4Polyline {}

export class FakeV4Circle extends FakeV4Overlay {
  center: FakeV4Point
  radius: number

  constructor(point: FakeV4Point, radius: number, options: Record<string, unknown>, stats: FakeV4EventStats) {
    super(options, stats)
    this.center = point
    this.radius = radius
  }
}

export class FakeV4Label extends FakeV4Overlay {
  content: string

  constructor(content: string, options: Record<string, unknown>, stats: FakeV4EventStats) {
    super(options, stats)
    this.content = content
  }
}

export class FakeV4InfoWindow extends FakeV4Overlay {
  content: string | HTMLElement
  open = false

  constructor(content: string | HTMLElement, options: Record<string, unknown>, stats: FakeV4EventStats) {
    super(options, stats)
    this.content = content
  }

  openInfoWindow(): void {
    this.open = true
    this.emit('open')
  }

  close(): void {
    this.open = false
    this.emit('close')
  }
}
