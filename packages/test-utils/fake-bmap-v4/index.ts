/**
 * Fake BMap v4 namespace
 *
 * JSAPI 4.0（`v=4.0`，全局 `BMap`）的最小可观察替身：几何构造器、Map、`MapTypeId`
 * 常量与核心覆盖物，以及统一的监听器统计。它位于 raw SDK 边界之外
 * （`packages/test-utils` 不在 `check-raw-sdk` 扫描范围内），是 v4 Driver 的 Fake 边界。
 *
 * 用法：
 *   const fake = createFakeBMapV4()
 *   const geometry = createJsapiV4GeometryDriver(fake.namespace)
 *   fake.stats.reset() // 每个用例开头重置
 */
import { FakeV4EventStats } from './event-target.ts'
import { FakeV4Map, FakeV4MapTypeId } from './FakeMap.ts'
import { FakeV4Bounds, FakeV4Pixel, FakeV4Point, FakeV4Size } from './geometry.ts'
import {
  FakeV4Circle,
  FakeV4InfoWindow,
  FakeV4Label,
  FakeV4Marker,
  FakeV4Polygon,
  FakeV4Polyline,
} from './objects.ts'

export { FakeV4EventStats, FakeV4EventTarget } from './event-target.ts'
export {
  FAKE_V4_INTERACTIONS,
  FakeV4Map,
  FakeV4MapTypeId,
} from './FakeMap.ts'
export type { FakeV4Interaction } from './FakeMap.ts'
export { FakeV4Bounds, FakeV4Pixel, FakeV4Point, FakeV4Size } from './geometry.ts'
export {
  FakeV4Circle,
  FakeV4InfoWindow,
  FakeV4Label,
  FakeV4Marker,
  FakeV4Overlay,
  FakeV4Polygon,
  FakeV4Polyline,
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
  Circle: new (point: FakeV4Point, radius: number, options?: Record<string, unknown>) => FakeV4Circle
  Label: new (content: string, options?: Record<string, unknown>) => FakeV4Label
  InfoWindow: new (content: string | HTMLElement, options?: Record<string, unknown>) => FakeV4InfoWindow
  /** 地图类型常量（官方 4.0.4 以静态成员声明在 `BMap.MapTypeId` 上）。 */
  MapTypeId: typeof FakeV4MapTypeId
  VERSION: string
}

export interface FakeBMapV4 {
  namespace: FakeBMapV4Namespace
  stats: FakeV4EventStats
  /** 测试辅助：记录已创建的 Map 实例 */
  createdMaps: FakeV4Map[]
}

export function createFakeBMapV4(version = '4.0'): FakeBMapV4 {
  const stats = new FakeV4EventStats()
  const createdMaps: FakeV4Map[] = []

  class MapClass extends FakeV4Map {
    constructor(container: string | HTMLElement, options?: Record<string, unknown>) {
      super(container, options ?? {}, stats)
      createdMaps.push(this)
    }
  }
  class MarkerClass extends FakeV4Marker {
    constructor(point: FakeV4Point, options?: Record<string, unknown>) {
      super(point, options ?? {}, stats)
    }
  }
  class PolylineClass extends FakeV4Polyline {
    constructor(path: FakeV4Point[], options?: Record<string, unknown>) {
      super(path, options ?? {}, stats)
    }
  }
  class PolygonClass extends FakeV4Polygon {
    constructor(path: FakeV4Point[], options?: Record<string, unknown>) {
      super(path, options ?? {}, stats)
    }
  }
  class CircleClass extends FakeV4Circle {
    constructor(point: FakeV4Point, radius: number, options?: Record<string, unknown>) {
      super(point, radius, options ?? {}, stats)
    }
  }
  class LabelClass extends FakeV4Label {
    constructor(content: string, options?: Record<string, unknown>) {
      super(content, options ?? {}, stats)
    }
  }
  class InfoWindowClass extends FakeV4InfoWindow {
    constructor(content: string | HTMLElement, options?: Record<string, unknown>) {
      super(content, options ?? {}, stats)
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
    Circle: CircleClass,
    Label: LabelClass,
    InfoWindow: InfoWindowClass,
    MapTypeId: FakeV4MapTypeId,
    VERSION: version,
  }

  return { namespace, stats, createdMaps }
}
