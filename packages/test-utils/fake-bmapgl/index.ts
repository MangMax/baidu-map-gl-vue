/**
 * Fake BMapGL
 *
 * 最小但可观察的百度 JSAPI GL 实现,供单元测试 / 浏览器 PR 测试使用。
 *
 * 统计能力(见 FakeStats):
 * - Map 实例创建/销毁
 * - Overlay/Control 实例创建/移除
 * - add/remove 次数
 * - SDK 事件 listener 数量(当前存活)
 * - destroy 调用次数
 * - 当前 visible/open 状态、传入 option
 *
 * 用法:
 *   const fake = createFakeBMapGl()
 *   window.BMapGL = fake.api
 *   fake.api.stats.reset()  // 每个用例开头重置
 */
import { FakeEventTarget } from './FakeEventTarget.ts'

export { FakeEventTarget }

export interface FakeStats {
  mapsCreated: number
  mapsDestroyed: number
  overlaysCreated: number
  overlaysRemoved: number
  controlsCreated: number
  controlsRemoved: number
  listenersAdded: number
  listenersRemoved: number
  /** 当前仍存在的 SDK listener 数 */
  get listeners(): number
  /** 当前仍存在的 Map 数 */
  get maps(): number
  reset(): void
}

export class FakeStatsImpl implements FakeStats {
  mapsCreated = 0
  mapsDestroyed = 0
  overlaysCreated = 0
  overlaysRemoved = 0
  controlsCreated = 0
  controlsRemoved = 0
  listenersAdded = 0
  listenersRemoved = 0

  get listeners(): number {
    return this.listenersAdded - this.listenersRemoved
  }
  get maps(): number {
    return this.mapsCreated - this.mapsDestroyed
  }
  reset(): void {
    this.mapsCreated = 0
    this.mapsDestroyed = 0
    this.overlaysCreated = 0
    this.overlaysRemoved = 0
    this.controlsCreated = 0
    this.controlsRemoved = 0
    this.listenersAdded = 0
    this.listenersRemoved = 0
  }
}

export interface FakePoint {
  lng: number
  lat: number
  constructor(lng: number, lat: number): void
}

export interface FakeSize {
  width: number
  height: number
  constructor(width: number, height: number): void
}

export default class FakePointImpl {
  lng: number
  lat: number
  constructor(lng: number, lat: number) {
    this.lng = lng
    this.lat = lat
  }
}

export class FakeSizeImpl {
  width: number
  height: number
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }
}

/** 每个伪造实例统一带 option 记录,便于断言 */
export interface RecordedOptions {
  options: Record<string, unknown>
  callLog: string[]
}

export function createCallLog(owner: { callLog: string[] }) {
  return (name: string) => (...args: unknown[]) => {
    owner.callLog.push(name)
  }
}

/**
 * 事件的浅包装(与真实 SDK 一致,组件不应直接使用私有字段)
 */
export interface FakeSdkEvent<E = Record<string, unknown>> {
  type: string
  domEvent?: Event
  preventDefault?: () => void
  stopPropagation?: () => void
  [key: string]: unknown
}

/**
 * Fake Map:实现 BMap 组件 init 阶段会用到的全部方法
 */
export class FakeMap extends FakeEventTarget {
  stats: FakeStatsImpl
  container: HTMLElement
  options: Record<string, unknown>
  callLog: string[] = []
  overlays: Set<unknown> = new Set()
  controls: Set<unknown> = new Set()
  center: FakePoint | null = null
  zoom: number | null = null
  heading = 0
  tilt = 0
  destroyed = false
  destroyedBy = ''
  openInfoWindows: Set<unknown> = new Set()

  constructor(container: string | HTMLElement, opts?: Record<string, unknown>, stats?: FakeStatsImpl) {
    super()
    this.stats = stats ?? new FakeStatsImpl()
    this.container =
      typeof container === 'string' ? document.getElementById(container) ?? document.createElement('div') : container
    this.options = opts ?? {}
  }

  addOverlay(overlay: { type?: string }) {
    this.callLog.push('addOverlay')
    this.overlays.add(overlay)
    this.stats.overlaysCreated++
  }

  removeOverlay(overlay: { type?: string }) {
    this.callLog.push('removeOverlay')
    if (this.overlays.delete(overlay)) {
      this.stats.overlaysRemoved++
    }
  }

  clearOverlays() {
    this.callLog.push('clearOverlays')
    for (const o of this.overlays) {
      this.stats.overlaysRemoved++
    }
    this.overlays.clear()
  }

  addControl(control: unknown) {
    this.callLog.push('addControl')
    this.controls.add(control)
    this.stats.controlsCreated++
  }

  removeControl(control: unknown) {
    this.callLog.push('removeControl')
    if (this.controls.delete(control)) {
      this.stats.controlsRemoved++
    }
  }

  addDistrictLayer(layer: unknown) {
    this.callLog.push('addDistrictLayer')
    this.overlays.add(layer)
    this.stats.overlaysCreated++
  }

  removeDistrictLayer(layer: unknown) {
    this.callLog.push('removeDistrictLayer')
    if (this.overlays.delete(layer)) {
      this.stats.overlaysRemoved++
    }
  }

  addTileLayer(layer: unknown) {
    this.callLog.push('addTileLayer')
    this.overlays.add(layer)
    this.stats.overlaysCreated++
  }

  removeTileLayer(layer: unknown) {
    this.callLog.push('removeTileLayer')
    if (this.overlays.delete(layer)) {
      this.stats.overlaysRemoved++
    }
  }

  openInfoWindow(win: unknown, point?: FakePoint) {
    this.callLog.push(`openInfoWindow:${point ? `${point.lng},${point.lat}` : ''}`)
    this.openInfoWindows.add(win)
    if (typeof (win as { openInfoWindow?: unknown }).openInfoWindow === 'function') {
      ;(win as { openInfoWindow(point?: FakePoint): void }).openInfoWindow(point)
    }
  }

  closeInfoWindow(win: unknown) {
    this.callLog.push('closeInfoWindow')
    this.openInfoWindows.delete(win)
  }

  getContainer(): HTMLElement {
    return this.container
  }

  getCenter(): FakePoint | string | null {
    return this.center
  }

  getZoom(): number | null {
    return this.zoom
  }

  getHeading(): number {
    return this.heading
  }

  getTilt(): number {
    return this.tilt
  }

  getSize() {
    return { width: this.container.clientWidth || 300, height: this.container.clientHeight || 300 }
  }

  getBounds() {
    return {
      getSouthWest: () => ({ lng: 0, lat: 0 }),
      getNorthEast: () => ({ lng: 180, lat: 90 }),
    }
  }

  centerAndZoom(point: FakePoint | string, zoom?: number) {
    this.callLog.push('centerAndZoom')
    this.center = typeof point === 'string' ? { lng: 0, lat: 0 } : point
    if (typeof zoom === 'number') this.zoom = zoom
  }

  setCenter(point: FakePoint | string) {
    this.callLog.push('setCenter')
    this.center = typeof point === 'string' ? { lng: 0, lat: 0 } : point
  }

  setView(center: FakePoint | string, zoom: number) {
    this.callLog.push('setView')
    this.center = typeof center === 'string' ? { lng: 0, lat: 0 } : center
    this.zoom = zoom
  }

  setZoom(zoom: number, opts?: Record<string, unknown>) {
    this.callLog.push('setZoom')
    this.zoom = zoom
  }

  setHeading(heading: number) {
    this.callLog.push('setHeading')
    this.heading = heading
  }

  setTilt(tilt: number) {
    this.callLog.push('setTilt')
    this.tilt = tilt
  }

  setMapType() {
    this.callLog.push('setMapType')
  }

  setMapStyleV2() {
    this.callLog.push('setMapStyleV2')
  }

  setTrafficOn() {
    this.callLog.push('setTrafficOn')
  }
  setTrafficOff() {
    this.callLog.push('setTrafficOff')
  }
  enableDragging() {
    this.callLog.push('enableDragging')
  }
  disableDragging() {
    this.callLog.push('disableDragging')
  }
  enableInertialDragging() {
    this.callLog.push('enableInertialDragging')
  }
  disableInertialDragging() {
    this.callLog.push('disableInertialDragging')
  }
  enableScrollWheelZoom() {
    this.callLog.push('enableScrollWheelZoom')
  }
  disableScrollWheelZoom() {
    this.callLog.push('disableScrollWheelZoom')
  }
  enableContinuousZoom() {
    this.callLog.push('enableContinuousZoom')
  }
  disableContinuousZoom() {
    this.callLog.push('disableContinuousZoom')
  }
  enableResizeOnCenter() {
    this.callLog.push('enableResizeOnCenter')
  }
  disableResizeOnCenter() {
    this.callLog.push('disableResizeOnCenter')
  }
  enableDoubleClickZoom() {
    this.callLog.push('enableDoubleClickZoom')
  }
  disableDoubleClickZoom() {
    this.callLog.push('disableDoubleClickZoom')
  }
  enableKeyboard() {
    this.callLog.push('enableKeyboard')
  }
  disableKeyboard() {
    this.callLog.push('disableKeyboard')
  }
  enablePinchToZoom() {
    this.callLog.push('enablePinchToZoom')
  }
  disablePinchToZoom() {
    this.callLog.push('disablePinchToZoom')
  }
  enableAutoResize() {
    this.callLog.push('enableAutoResize')
  }
  disableAutoResize() {
    this.callLog.push('disableAutoResize')
  }

  destroy() {
    this.callLog.push('destroy')
    if (this.destroyed) return
    this.destroyed = true
    this.stats.mapsDestroyed++
  }

  checkResize() {
    this.callLog.push('checkResize')
  }

  panTo() {
    this.callLog.push('panTo')
  }

  addContextMenu(menu: unknown) {
    this.callLog.push('addContextMenu')
  }
  removeContextMenu(menu: unknown) {
    this.callLog.push('removeContextMenu')
  }

  getPosition(): FakePoint | null {
    return this.center
  }
}

/**
 * Fake Marker:实现 marker 组件用到的 API + 状态可读
 */
export class FakeMarker extends FakeEventTarget implements RecordedOptions {
  options: Record<string, unknown>
  callLog: string[] = []
  position: FakePoint
  icon: unknown
  zIndex: number | null = null
  rotation: number | null = null
  offset: FakeSize | null = null
  visible = true

  constructor(point: FakePoint, options: Record<string, unknown> = {}) {
    super()
    this.position = point
    this.options = options
  }

  setPosition(point: FakePoint) {
    this.callLog.push('setPosition')
    this.position = point
  }
  setIcon(icon: unknown) {
    this.callLog.push('setIcon')
    this.icon = icon
  }
  setZIndex(z: number) {
    this.callLog.push('setZIndex')
    this.zIndex = z
  }
  setRotation(rotation: number) {
    this.callLog.push('setRotation')
    this.rotation = rotation
  }
  setOffset(offset: FakeSize) {
    this.callLog.push('setOffset')
    this.offset = offset
  }
  enableDragging() {
    this.callLog.push('enableDragging')
  }
  disableDragging() {
    this.callLog.push('disableDragging')
  }
  enableMassClear() {
    this.callLog.push('enableMassClear')
  }
  disableMassClear() {
    this.callLog.push('disableMassClear')
  }
  setTitle() {
    this.callLog.push('setTitle')
  }
  addContextMenu(menu: unknown) {
    this.callLog.push('addContextMenu')
  }
  removeContextMenu(menu: unknown) {
    this.callLog.push('removeContextMenu')
  }
}

/**
 * Fake InfoWindow:实现 info window 组件用到的 API + open 状态可读
 */
/**
 * Fake Shape Overlay:支撑 Circle / Polyline / Polygon 等形状覆盖物
 * 记录 setCenter / setPath / setRadius 与各种样式 setter,便于断言字段级更新
 */
export class FakeShapeOverlay extends FakeEventTarget implements RecordedOptions {
  options: Record<string, unknown>
  callLog: string[] = []
  center: FakePoint | null = null
  radius: number | null = null
  path: FakePoint[] = []
  points: FakePoint[] = []
  strokeColor = ''
  fillColor = ''
  strokeWeight: number | null = null
  fillOpacity: number | null = null

  constructor(pointOrPath: FakePoint | FakePoint[], options: Record<string, unknown> = {}) {
    super()
    this.options = options
    this.strokeColor = (options.strokeColor as string) || ''
    this.fillColor = (options.fillColor as string) || ''
    this.strokeWeight = (options.strokeWeight as number) ?? null
    this.fillOpacity = (options.fillOpacity as number) ?? null
    if (Array.isArray(pointOrPath)) {
      this.path = pointOrPath
      this.points = pointOrPath
    } else {
      this.center = pointOrPath
    }
  }

  setCenter(point: FakePoint) {
    this.callLog.push('setCenter')
    this.center = point
    this.points = [point]
  }
  setRadius(radius: number) {
    this.callLog.push('setRadius')
    this.radius = radius
  }
  setPath(path: FakePoint[]) {
    this.callLog.push('setPath')
    this.path = path
    this.points = path
  }
  setStrokeColor(color: string) {
    this.callLog.push('setStrokeColor')
    this.strokeColor = color
  }
  setFillColor(color: string) {
    this.callLog.push('setFillColor')
    this.fillColor = color
  }
  setStrokeWeight(weight: number) {
    this.callLog.push('setStrokeWeight')
    this.strokeWeight = weight
  }
  setStrokeOpacity() {
    this.callLog.push('setStrokeOpacity')
  }
  setFillOpacity() {
    this.callLog.push('setFillOpacity')
  }
  setStrokeStyle() {
    this.callLog.push('setStrokeStyle')
  }
  enableMassClear() {
    this.callLog.push('enableMassClear')
  }
  disableMassClear() {
    this.callLog.push('disableMassClear')
  }
  enableEditing() {
    this.callLog.push('enableEditing')
  }
  disableEditing() {
    this.callLog.push('disableEditing')
  }
}

export class FakeCircle extends FakeShapeOverlay {
  constructor(point: FakePoint, radius: number, options: Record<string, unknown> = {}) {
    super(point, options)
    this.radius = radius
  }
}

export class FakePolyline extends FakeShapeOverlay {
  constructor(path: FakePoint[], options: Record<string, unknown> = {}) {
    super(path, options)
  }
}

export class FakePolygon extends FakeShapeOverlay {
  constructor(path: FakePoint[], options: Record<string, unknown> = {}) {
    super(path, options)
  }
}

export class FakeInfoWindow extends FakeEventTarget implements RecordedOptions {
  options: Record<string, unknown>
  callLog: string[] = []
  open = false
  hidden = false
  position: FakePoint | null = null
  content: string | HTMLElement = ''
  title = ''

  constructor(content: string | HTMLElement, options: Record<string, unknown> = {}) {
    super()
    this.content = content
    this.options = options
  }

  addEventListener(type: string, listener: (...args: unknown[]) => void): void {
    super.addEventListener(type, listener)
  }

  openInfoWindow(point?: FakePoint) {
    this.callLog.push('openInfoWindow')
    this.open = true
    this.hidden = false
    if (point) this.position = point
    this.emit('open', { type: 'open', reason: 'openInfoWindow' })
  }
  isOpen() {
    return this.open
  }
  hide() {
    this.callLog.push('hide')
    this.open = false
    this.hidden = true
    this.emit('close', { type: 'close', reason: 'hide' })
  }
  show() {
    this.callLog.push('show')
    this.open = true
    this.hidden = false
  }
  redraw() {
    this.callLog.push('redraw')
  }
  setTitle(title: string) {
    this.callLog.push('setTitle')
    this.title = title
  }
  setWidth() {
    this.callLog.push('setWidth')
  }
  setHeight() {
    this.callLog.push('setHeight')
  }
  setMaxWidth() {
    this.callLog.push('setMaxWidth')
  }
  setContent(content: string | HTMLElement) {
    this.callLog.push('setContent')
    this.content = content
  }
  setPosition(point: FakePoint) {
    this.callLog.push('setPosition')
    this.position = point
  }
  enableAutoPan() {
    this.callLog.push('enableAutoPan')
  }
  disableAutoPan() {
    this.callLog.push('disableAutoPan')
  }
  enableCloseOnClick() {
    this.callLog.push('enableCloseOnClick')
  }
  disableCloseOnClick() {
    this.callLog.push('disableCloseOnClick')
  }
}

/**
 * Fake Icon
 */
export class FakeGeolocation {
  getStatus() {
    return 0 // BMAP_STATUS_SUCCESS
  }
  /** 测试辅助:设置当前定位结果 */
  currentPosition: { point: FakePoint; accuracy: number; address: Record<string, string> } | null = null
  constructor(private readonly opts?: Record<string, unknown>) {}
  getCurrentPosition(cb: (res: any) => void) {
    if (this.currentPosition) {
      cb(this.currentPosition)
    } else {
      cb({ point: { lng: 116.4, lat: 39.9 }, accuracy: 20, address: {} })
    }
  }
}

export class FakeGeocoder {
  /** 测试辅助:设置 getPoint 行为 */
  pointHandler: ((address: string, city: string) => FakePoint | null) | null = null
  /** 测试辅助:记录调用 */
  calls: { address: string; city: string }[] = []
  /** 测试辅助:记录 getLocation 调用入参(应为 Point 实例,裸对象会被真机 SDK 拒收) */
  locationCalls: unknown[] = []
  /** 测试辅助:设置 getLocation 行为 */
  locationHandler: ((point: FakePoint) => Record<string, unknown> | null) | null = null
  constructor(private readonly opts?: Record<string, unknown>) {}
  getPoint(address: string, cb: (point: FakePoint | null) => void, city: string) {
    this.calls.push({ address, city })
    const point = this.pointHandler ? this.pointHandler(address, city) : { lng: 116.4, lat: 39.9 }
    cb(point as unknown as FakePoint)
  }
  getLocation(point: FakePoint, cb: (result: Record<string, unknown> | null) => void) {
    this.locationCalls.push(point)
    if (this.locationHandler) {
      cb(this.locationHandler(point))
      return
    }
    cb({
      point: { lng: point.lng, lat: point.lat },
      address: '北京市海淀区上地10街',
      addressComponents: {
        city: '北京市',
        district: '海淀区',
        province: '北京市',
        street: '上地10街',
        streetNumber: '',
      },
      surroundingPois: [{ title: '上地', point: { lng: point.lng, lat: point.lat } }],
      business: '上地',
    })
  }
}

export class FakeConvertor {
  /** 测试辅助:设置 translate 行为 */
  translateHandler: ((points: FakePoint[]) => { points: FakePoint[]; status: number }) | null = null
  constructor(private readonly opts?: Record<string, unknown>) {}
  translate(points: FakePoint[], from: number, to: number, cb: (res: { points: FakePoint[]; status: number }) => void) {
    const res = this.translateHandler
      ? this.translateHandler(points)
      : { points: points.map((p) => ({ lng: p.lng + 1, lat: p.lat + 1 })), status: 0 }
    cb(res)
  }
}


export class FakeContextMenu extends FakeEventTarget {
  items: unknown[] = []
  addItem(item: unknown) {
    this.items.push(item)
  }
  addSeparator() {
    this.items.push('-')
  }
}

export class FakeMenuItem {
  constructor(
    public readonly text: string,
    public readonly callback: (...args: any[]) => void,
    public readonly opts?: Record<string, unknown>,
  ) {}
}

export class FakeTrackAnimation {
  status = 1 // PLAYING
  callLog: string[] = []
  constructor(public readonly map: unknown, public readonly path: unknown, public readonly opts?: Record<string, unknown>) {}
  start() {
    this.callLog.push('start')
    this.status = 1
  }
  pause() {
    this.callLog.push('pause')
    this.status = 3
  }
  cancel() {
    this.callLog.push('cancel')
    this.status = 2
  }
}

export class FakeControl {
  options: Record<string, unknown>
  callLog: string[] = []
  visible = true
  defaultAnchor?: unknown
  defaultOffset?: unknown
  initialize?: (map: unknown) => HTMLElement
  constructor(options: Record<string, unknown> = {}) {
    this.options = options
  }

  show() {
    this.visible = true
  }

  hide() {
    this.visible = false
  }
}

export class FakeZoomControl extends FakeControl {}
export class FakeScaleControl extends FakeControl {}
export class FakeCityListControl extends FakeControl {}
export class FakeLocationControl extends FakeControl {}
export class FakeNavigationControl3D extends FakeControl {}
export class FakeCopyrightControl extends FakeControl {
  copyrights: { id: number; content: string; bounds?: unknown }[] = []

  addCopyright(copyright: { id: number; content: string; bounds?: unknown }) {
    this.copyrights = [...this.copyrights.filter((item) => item.id !== copyright.id), copyright]
  }

  removeCopyright(id: number) {
    this.copyrights = this.copyrights.filter((item) => item.id !== id)
  }

  getCopyrightCollection() {
    return this.copyrights
  }
}
export class FakePanoramaControl extends FakeControl {}
export class FakeAutocomplete extends FakeEventTarget {
  input: HTMLInputElement | undefined
  options: Record<string, unknown>
  callLog: string[] = []
  location: unknown
  types: string[] | undefined
  constructor(options: Record<string, unknown> = {}) {
    super()
    this.input = options.input as HTMLInputElement | undefined
    this.location = options.location
    this.types = options.types as string[] | undefined
    this.options = options
    if (typeof options.onSearchComplete === 'function') {
      ;(options.onSearchComplete as (e: unknown) => void)({ type: 'searchcomplete' })
    }
  }
  setLocation(loc: unknown) {
    this.location = loc
    this.callLog.push('setLocation')
  }
  setTypes(types: string[]) {
    this.types = types
    this.callLog.push('setTypes')
  }
}

export class FakeDistrictLayer {
  options: Record<string, unknown>
  callLog: string[] = []
  constructor(options: Record<string, unknown> = {}) {
    this.options = options
  }
}

export class FakePanoramaCoverageLayer {
  callLog: string[] = []
  constructor() {}
}

export class FakeBezierCurve extends FakeShapeOverlay {
  path: FakePoint[]
  controlPoints: FakePoint[][]
  constructor(path: FakePoint[], controlPoints: FakePoint[][], options: Record<string, unknown> = {}) {
    super(path, options)
    this.path = path
    this.controlPoints = controlPoints
  }
  setControlPoints(points: FakePoint[][]) {
    this.controlPoints = points
    this.callLog.push('setControlPoints')
  }
}

export class FakeMapMask extends FakeShapeOverlay {
  constructor(path: FakePoint[], options: Record<string, unknown> = {}) {
    super(path, options)
  }
}

export class FakeMarker3D extends FakeEventTarget implements RecordedOptions {
  options: Record<string, unknown>
  callLog: string[] = []
  position: FakePoint
  height: number
  constructor(point: FakePoint, height: number, options: Record<string, unknown> = {}) {
    super()
    this.position = point
    this.height = height
    this.options = options
  }
  setPosition(point: FakePoint) {
    this.position = point
    this.callLog.push('setPosition')
  }
  setHeight(height: number) {
    this.height = height
    this.callLog.push('setHeight')
  }
  setFillColor(color: string) {
    this.options.fillColor = color
    this.callLog.push('setFillColor')
  }
  setFillOpacity(opacity: number) {
    this.options.fillOpacity = opacity
    this.callLog.push('setFillOpacity')
  }
  setIcon(icon: unknown) {
    this.options.icon = icon
    this.callLog.push('setIcon')
  }
  enableMassClear() {
    this.callLog.push('enableMassClear')
  }
  disableMassClear() {
    this.callLog.push('disableMassClear')
  }
}

export class FakeBounds {
  constructor(
    public readonly sw: FakePoint,
    public readonly ne: FakePoint,
  ) {}
  getCenter() {
    return {
      lng: (this.sw.lng + this.ne.lng) / 2,
      lat: (this.sw.lat + this.ne.lat) / 2,
    }
  }
}

export class FakeGroundOverlay extends FakeEventTarget implements RecordedOptions {
  options: Record<string, unknown>
  callLog: string[] = []
  bounds: FakeBounds
  opacity: number | null = null
  url: unknown = null
  isVisible = true

  constructor(bounds: FakeBounds, options: Record<string, unknown> = {}) {
    super()
    this.bounds = bounds
    this.options = options
    this.opacity = (options.opacity as number) ?? null
    this.url = options.url ?? null
  }

  setOpacity(o: number) {
    this.callLog.push('setOpacity')
    this.opacity = o
  }
  setBounds(b: FakeBounds) {
    this.callLog.push('setBounds')
    this.bounds = b
  }
  setUrl(url: unknown) {
    this.callLog.push('setUrl')
    this.url = url
  }
  getBounds() {
    return this.bounds
  }
}

export class FakePrism extends FakeEventTarget implements RecordedOptions {  options: Record<string, unknown>
  callLog: string[] = []
  path: FakePoint[] = []
  altitude: number
  topFillColor = ''
  sideFillColor = ''
  topFillOpacity: number | null = null
  sideFillOpacity: number | null = null

  constructor(path: FakePoint[], altitude: number, options: Record<string, unknown> = {}) {
    super()
    this.path = path
    this.altitude = altitude
    this.options = options
    this.topFillColor = (options.topFillColor as string) || ''
    this.sideFillColor = (options.sideFillColor as string) || ''
    this.topFillOpacity = (options.topFillOpacity as number) ?? null
    this.sideFillOpacity = (options.sideFillOpacity as number) ?? null
  }

  setPath(path: FakePoint[]) {
    this.callLog.push('setPath')
    this.path = path
  }
  setAltitude(altitude: number) {
    this.callLog.push('setAltitude')
    this.altitude = altitude
  }
  setTopFillColor(c: string) {
    this.callLog.push('setTopFillColor')
    this.topFillColor = c
  }
  setTopFillOpacity(o: number) {
    this.callLog.push('setTopFillOpacity')
    this.topFillOpacity = o
  }
  setSideFillColor(c: string) {
    this.callLog.push('setSideFillColor')
    this.sideFillColor = c
  }
  setSideFillOpacity(o: number) {
    this.callLog.push('setSideFillOpacity')
    this.sideFillOpacity = o
  }
  enableMassClear() {
    this.callLog.push('enableMassClear')
  }
  disableMassClear() {
    this.callLog.push('disableMassClear')
  }
  getBounds() {
    return { getCenter: () => ({ lng: 0, lat: 0 }) } as any
  }
}

export class FakeLabel extends FakeEventTarget implements RecordedOptions {
  options: Record<string, unknown>
  callLog: string[] = []
  content: string
  position: FakePoint | null = null
  offset: FakeSize | null = null
  zIndex: number | null = null
  style: Record<string, unknown> = {}

  constructor(content: string, options: Record<string, unknown> = {}) {
    super()
    this.content = content
    this.options = options
    this.position = (options.position as FakePoint) ?? null
    this.offset = (options.offset as FakeSize) ?? null
  }

  setContent(content: string) {
    this.callLog.push('setContent')
    this.content = content
  }
  setPosition(position: FakePoint) {
    this.callLog.push('setPosition')
    this.position = position
  }
  setOffset(offset: FakeSize) {
    this.callLog.push('setOffset')
    this.offset = offset
  }
  setZIndex(z: number) {
    this.callLog.push('setZIndex')
    this.zIndex = z
  }
  setStyle(style: Record<string, unknown>) {
    this.callLog.push('setStyle')
    this.style = style
  }
  enableMassClear() {
    this.callLog.push('enableMassClear')
  }
  disableMassClear() {
    this.callLog.push('disableMassClear')
  }
}

export class FakeIcon {
  imageUrl: string
  size: FakeSize
  options: Record<string, unknown>
  constructor(imageUrl: string, size: FakeSize, options: Record<string, unknown> = {}) {
    this.imageUrl = imageUrl
    this.size = size
    this.options = options
  }
}

/**
 * 创建完整 fake BMapGL namespace,返回 promiseBMapGL 兼容对象
 */
export interface FakeBMapGlApi {
  Map: typeof FakeMap
  Marker: typeof FakeMarker
  InfoWindow: typeof FakeInfoWindow
  Icon: typeof FakeIcon
  Geolocation: typeof FakeGeolocation
  Geocoder: typeof FakeGeocoder
  Convertor: typeof FakeConvertor
  ContextMenu: typeof FakeContextMenu
  MenuItem: typeof FakeMenuItem
  TrackAnimation: typeof FakeTrackAnimation
  ZoomControl: typeof FakeZoomControl
  ScaleControl: typeof FakeScaleControl
  CityListControl: typeof FakeCityListControl
  LocationControl: typeof FakeLocationControl
  NavigationControl3D: typeof FakeNavigationControl3D
  CopyrightControl: typeof FakeCopyrightControl
  PanoramaControl: typeof FakePanoramaControl
  Autocomplete: typeof FakeAutocomplete
  BezierCurve: typeof FakeBezierCurve
  MapMask: typeof FakeMapMask
  Marker3D: typeof FakeMarker3D
  Control: typeof FakeControl
  DistrictLayer: typeof FakeDistrictLayer
  PanoramaCoverageLayer: typeof FakePanoramaCoverageLayer
  Prism: typeof FakePrism
  Label: typeof FakeLabel
  Circle: typeof FakeCircle
  Polyline: typeof FakePolyline
  Polygon: typeof FakePolygon
  Point: typeof FakePointImpl
  Size: typeof FakeSizeImpl
  Bounds: typeof FakeBounds
  GroundOverlay: typeof FakeGroundOverlay
  BMAP_NORMAL_MAP: string
  BMAP_EARTH_MAP: string
  BMAP_SATELLITE_MAP: string
  stats: FakeStatsImpl
  /** 测试辅助:记录已创建的 Map 实例 */
  createdMaps: FakeMap[]
}

function withStatsCounter<T extends FakeEventTarget>(instance: T, stats: FakeStatsImpl): T {
  instance.setListenerCounter((d) => {
    if (d > 0) stats.listenersAdded++
    else stats.listenersRemoved++
  })
  return instance
}

export function createFakeBMapGl(): FakeBMapGlApi {
  const stats = new FakeStatsImpl()
  const createdMaps: FakeMap[] = []
  const api: FakeBMapGlApi = {
    Map: class extends FakeMap {
      constructor(container: string | HTMLElement, opts?: Record<string, unknown>) {
        super(container, opts, stats)
        stats.mapsCreated++
        withStatsCounter(this, stats)
        createdMaps.push(this)
      }
    },
    Marker: class extends FakeMarker {
      constructor(point: FakePoint, opts?: Record<string, unknown>) {
        super(point, opts)
        withStatsCounter(this, stats)
      }
    },
    InfoWindow: class extends FakeInfoWindow {
      constructor(content: string | HTMLElement, options: Record<string, unknown> = {}) {
        super(content, options)
        withStatsCounter(this, stats)
      }
    },
    Circle: class extends FakeCircle {
      constructor(point: FakePoint, radius: number, options: Record<string, unknown> = {}) {
        super(point, radius, options)
        withStatsCounter(this, stats)
      }
    },
    Polyline: class extends FakePolyline {
      constructor(path: FakePoint[], options: Record<string, unknown> = {}) {
        super(path, options)
        withStatsCounter(this, stats)
      }
    },
    Polygon: class extends FakePolygon {
      constructor(path: FakePoint[], options: Record<string, unknown> = {}) {
        super(path, options)
        withStatsCounter(this, stats)
      }
    },
    BezierCurve: class extends FakeBezierCurve {
      constructor(path: FakePoint[], controlPoints: FakePoint[][], options: Record<string, unknown> = {}) {
        super(path, controlPoints, options)
        withStatsCounter(this, stats)
      }
    },
    MapMask: class extends FakeMapMask {
      constructor(path: FakePoint[], options: Record<string, unknown> = {}) {
        super(path, options)
        withStatsCounter(this, stats)
      }
    },
    Marker3D: class extends FakeMarker3D {
      constructor(point: FakePoint, height: number, options: Record<string, unknown> = {}) {
        super(point, height, options)
        withStatsCounter(this, stats)
      }
    },
    Icon: FakeIcon,
    Geolocation: FakeGeolocation,
    Geocoder: FakeGeocoder,
    Convertor: FakeConvertor,
    ContextMenu: FakeContextMenu,
    MenuItem: FakeMenuItem,
    TrackAnimation: FakeTrackAnimation,
    ZoomControl: FakeZoomControl,
    ScaleControl: FakeScaleControl,
    CityListControl: FakeCityListControl,
    LocationControl: FakeLocationControl,
    NavigationControl3D: FakeNavigationControl3D,
    CopyrightControl: FakeCopyrightControl,
    PanoramaControl: FakePanoramaControl,
    Autocomplete: FakeAutocomplete,
    Control: FakeControl,
    DistrictLayer: FakeDistrictLayer,
    PanoramaCoverageLayer: FakePanoramaCoverageLayer,
    Prism: class extends FakePrism {
      constructor(path: FakePoint[], altitude: number, options: Record<string, unknown> = {}) {
        super(path, altitude, options)
        withStatsCounter(this, stats)
      }
    },
    Label: class extends FakeLabel {
      constructor(content: string, options: Record<string, unknown> = {}) {
        super(content, options)
        withStatsCounter(this, stats)
      }
    },
    Bounds: FakeBounds,
    GroundOverlay: class extends FakeGroundOverlay {
      constructor(bounds: FakeBounds, options: Record<string, unknown> = {}) {
        super(bounds, options)
        withStatsCounter(this, stats)
      }
    },
    Point: FakePointImpl,
    Size: FakeSizeImpl,
    BMAP_NORMAL_MAP: 'BMAP_NORMAL_MAP',
    BMAP_EARTH_MAP: 'BMAP_EARTH_MAP',
    BMAP_SATELLITE_MAP: 'BMAP_SATELLITE_MAP',
    stats,
    createdMaps,
  }
  return api
}

/**
 * 让 BMapGL namespace 下所有可发射事件的 SDK 对象都可被观测
 */
export type { FakeBMapGlApi }
