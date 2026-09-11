/**
 * Fake BMap v4 namespace
 *
 * JSAPI 4.0（`v=4.0`，全局 `BMap`）的最小可观察替身：几何构造器、Map、`MapTypeId`
 * 常量、核心与高级覆盖物、右键菜单与图标，以及统一的监听器统计。它位于 raw SDK 边界之外
 * （`packages/test-utils` 不在 `check-raw-sdk` 扫描范围内），是 v4 Driver 的 Fake 边界。
 *
 * 刻意**不提供** `Marker3D` / `MapMask`：这两个构造器不在 `@baidumap/jsapi-v4-types@4.0.4`
 * 的声明里，官方参考也没有对应章节，属于「本引擎没有可核对的运行时入口」的成员。
 * 覆盖物 Facet（#21）据此把它们做成显式失败路径，Fake 缺这两个成员正是那条路径的测试依据。
 *
 * 用法：
 *   const fake = createFakeBMapV4()
 *   const geometry = createJsapiV4GeometryDriver(fake.namespace)
 *   fake.stats.reset() // 每个用例开头重置
 */
import { FakeV4EventStats } from './event-target.ts'
import {
  FakeV4Map,
  FakeV4MapTypeId,
  FakeV4ViewAnimation,
  type FakeV4AnimationOptions,
} from './FakeMap.ts'
import { FakeV4Bounds, FakeV4Pixel, FakeV4Point, FakeV4Size } from './geometry.ts'
import {
  FakeV4BezierCurve,
  FakeV4Circle,
  FakeV4ContextMenu,
  FakeV4CustomOverlay,
  FakeV4GroundOverlay,
  FakeV4Icon,
  FakeV4InfoWindow,
  FakeV4Label,
  FakeV4Marker,
  FakeV4MenuItem,
  FakeV4Polygon,
  FakeV4Polyline,
  FakeV4Prism,
  FakeV4Rectangle,
} from './objects.ts'

export { FakeV4EventStats, FakeV4EventTarget } from './event-target.ts'
export {
  FAKE_V4_INTERACTIONS,
  FakeV4Map,
  FakeV4MapTypeId,
  FakeV4ViewAnimation,
} from './FakeMap.ts'
export type { FakeV4AnimationOptions, FakeV4Interaction } from './FakeMap.ts'
export { FakeV4Bounds, FakeV4Pixel, FakeV4Point, FakeV4Size } from './geometry.ts'
export {
  FakeV4BezierCurve,
  FakeV4Circle,
  FakeV4ContextMenu,
  FakeV4CustomOverlay,
  FakeV4GroundOverlay,
  FakeV4Icon,
  FakeV4InfoWindow,
  FakeV4Label,
  FakeV4Marker,
  FakeV4MenuItem,
  FakeV4Overlay,
  FakeV4Polygon,
  FakeV4Polyline,
  FakeV4Prism,
  FakeV4Rectangle,
} from './objects.ts'

export interface FakeBMapV4Namespace {
  Map: new (container: string | HTMLElement, options?: Record<string, unknown>) => FakeV4Map
  Point: new (lng: number, lat: number) => FakeV4Point
  Pixel: new (x: number, y: number) => FakeV4Pixel
  Size: new (width: number, height: number) => FakeV4Size
  Bounds: new (sw?: FakeV4Point, ne?: FakeV4Point) => FakeV4Bounds
  Marker: new (point: FakeV4Point, options?: Record<string, unknown>) => FakeV4Marker
  Polyline: new (path: FakeV4Point[], options?: Record<string, unknown>) => FakeV4Polyline
  Polygon: new (path: FakeV4Point[], options?: Record<string, unknown>) => FakeV4Polygon
  Rectangle: new (bounds: FakeV4Bounds, options?: Record<string, unknown>) => FakeV4Rectangle
  Circle: new (point: FakeV4Point, radius: number, options?: Record<string, unknown>) => FakeV4Circle
  Label: new (content: string, options?: Record<string, unknown>) => FakeV4Label
  InfoWindow: new (content: string | HTMLElement, options?: Record<string, unknown>) => FakeV4InfoWindow
  GroundOverlay: new (bounds: FakeV4Bounds, options?: Record<string, unknown>) => FakeV4GroundOverlay
  Prism: new (
    path: FakeV4Point[],
    altitude: number,
    options?: Record<string, unknown>,
  ) => FakeV4Prism
  BezierCurve: new (
    path: FakeV4Point[],
    controlPoints: FakeV4Point[][],
    options?: Record<string, unknown>,
  ) => FakeV4BezierCurve
  CustomOverlay: new (
    domCreate: () => HTMLElement,
    options?: Record<string, unknown>,
  ) => FakeV4CustomOverlay
  ContextMenu: new (options?: Record<string, unknown>) => FakeV4ContextMenu
  MenuItem: new (
    text: string,
    callback: (...args: unknown[]) => void,
    options?: Record<string, unknown>,
  ) => FakeV4MenuItem
  Icon: new (
    image: string | HTMLCanvasElement | HTMLImageElement,
    size: FakeV4Size,
    opts?: Record<string, unknown>,
  ) => FakeV4Icon
  /** 视角动画构造器（官方 `BMap.ViewAnimation`）。 */
  ViewAnimation: new (
    keyFrames: unknown[],
    options?: FakeV4AnimationOptions,
  ) => FakeV4ViewAnimation
  /** 地图类型常量（官方 4.0.4 以静态成员声明在 `BMap.MapTypeId` 上）。 */
  MapTypeId: typeof FakeV4MapTypeId
  VERSION: string
}

export interface FakeBMapV4 {
  namespace: FakeBMapV4Namespace
  stats: FakeV4EventStats
  /** 测试辅助：记录已创建的 Map 实例 */
  createdMaps: FakeV4Map[]
  /** 测试辅助：记录已创建的覆盖物实例（构造器调用计数，用于「重建一次」断言） */
  createdOverlays: unknown[]
}

export function createFakeBMapV4(version = '4.0'): FakeBMapV4 {
  const stats = new FakeV4EventStats()
  const createdMaps: FakeV4Map[] = []
  const createdOverlays: unknown[] = []

  class MapClass extends FakeV4Map {
    constructor(container: string | HTMLElement, options?: Record<string, unknown>) {
      super(container, options ?? {}, stats)
      createdMaps.push(this)
    }
  }
  class MarkerClass extends FakeV4Marker {
    constructor(point: FakeV4Point, options?: Record<string, unknown>) {
      super(point, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class PolylineClass extends FakeV4Polyline {
    constructor(path: FakeV4Point[], options?: Record<string, unknown>) {
      super(path, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class PolygonClass extends FakeV4Polygon {
    constructor(path: FakeV4Point[], options?: Record<string, unknown>) {
      super(path, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class RectangleClass extends FakeV4Rectangle {
    constructor(bounds: FakeV4Bounds, options?: Record<string, unknown>) {
      super(bounds, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class CircleClass extends FakeV4Circle {
    constructor(point: FakeV4Point, radius: number, options?: Record<string, unknown>) {
      super(point, radius, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class LabelClass extends FakeV4Label {
    constructor(content: string, options?: Record<string, unknown>) {
      super(content, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class InfoWindowClass extends FakeV4InfoWindow {
    constructor(content: string | HTMLElement, options?: Record<string, unknown>) {
      super(content, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class GroundOverlayClass extends FakeV4GroundOverlay {
    constructor(bounds: FakeV4Bounds, options?: Record<string, unknown>) {
      super(bounds, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class PrismClass extends FakeV4Prism {
    constructor(path: FakeV4Point[], altitude: number, options?: Record<string, unknown>) {
      super(path, altitude, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class BezierCurveClass extends FakeV4BezierCurve {
    constructor(path: FakeV4Point[], controlPoints: FakeV4Point[][], options?: Record<string, unknown>) {
      super(path, controlPoints, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class CustomOverlayClass extends FakeV4CustomOverlay {
    constructor(domCreate: () => HTMLElement, options?: Record<string, unknown>) {
      super(domCreate, options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class ContextMenuClass extends FakeV4ContextMenu {
    constructor(options?: Record<string, unknown>) {
      super(options ?? {}, stats)
      createdOverlays.push(this)
    }
  }
  class ViewAnimationClass extends FakeV4ViewAnimation {
    constructor(keyFrames: unknown[], options?: FakeV4AnimationOptions) {
      super(keyFrames, options ?? {}, stats)
    }
  }

  const namespace: FakeBMapV4Namespace = {
    Map: MapClass,
    Point: FakeV4Point,
    Pixel: FakeV4Pixel,
    Size: FakeV4Size,
    Bounds: FakeV4Bounds,
    Marker: MarkerClass,
    Polyline: PolylineClass,
    Polygon: PolygonClass,
    Rectangle: RectangleClass,
    Circle: CircleClass,
    Label: LabelClass,
    InfoWindow: InfoWindowClass,
    GroundOverlay: GroundOverlayClass,
    Prism: PrismClass,
    BezierCurve: BezierCurveClass,
    CustomOverlay: CustomOverlayClass,
    ContextMenu: ContextMenuClass,
    MenuItem: FakeV4MenuItem,
    Icon: FakeV4Icon,
    ViewAnimation: ViewAnimationClass,
    MapTypeId: FakeV4MapTypeId,
    VERSION: version,
  }

  return { namespace, stats, createdMaps, createdOverlays }
}
