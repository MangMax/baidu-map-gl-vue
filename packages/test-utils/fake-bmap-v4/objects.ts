/**
 * Fake BMap v4 运行对象（Overlay）
 *
 * 只实现 M3A.2 基础边界（M3A2-01/02）与覆盖物 Facet（#21）需要的成员。
 * Map 本体在 `./FakeMap.ts`（M3A2-MAP / #20）：它有独立的视野、交互、投影与释放语义，
 * 继续堆在本文件会让「Map 是被测 facet」这一事实埋在覆盖物里。
 */
import { FakeV4EventTarget, type FakeV4EventStats } from './event-target.ts'
import { FakeV4Point } from './geometry.ts'

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
