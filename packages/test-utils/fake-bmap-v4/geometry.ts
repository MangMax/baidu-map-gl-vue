/**
 * Fake BMap v4 几何值对象
 *
 * 行为对齐官方 JSAPI 4.0（见 `bmap-jsapi-v4/references/coordinates-and-geometry.md`）：
 * - `Point` 构造参数顺序是 `lng, lat`，且**不做取值范围校验**；
 * - `Point` / `Pixel` / `Bounds` 有 `clone()`，`Size` 没有；
 * - `Bounds` 允许无参创建空范围，空范围内 `getSouthWest()` / `getNorthEast()` /
 *   `getCenter()` 返回 `null`（官方类型声明为不可空，运行时并非如此）。
 */

export class FakeV4Point {
  lng: number
  lat: number

  constructor(lng: number, lat: number) {
    this.lng = lng
    this.lat = lat
  }

  equals(other: FakeV4Point | null | undefined): boolean {
    if (!other) return false
    return Math.abs(this.lng - other.lng) < 1e-8 && Math.abs(this.lat - other.lat) < 1e-8
  }

  clone(): FakeV4Point {
    return new FakeV4Point(this.lng, this.lat)
  }
}

export class FakeV4Pixel {
  x: number
  y: number

  constructor(x: number, y: number) {
    this.x = x
    this.y = y
  }

  equals(other: FakeV4Pixel | null | undefined): boolean {
    if (!other) return false
    return this.x === other.x && this.y === other.y
  }

  clone(): FakeV4Pixel {
    return new FakeV4Pixel(this.x, this.y)
  }
}

export class FakeV4Size {
  width: number
  height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  equals(other: FakeV4Size | null | undefined): boolean {
    if (!other) return false
    return this.width === other.width && this.height === other.height
  }
}

export class FakeV4Bounds {
  private sw?: FakeV4Point
  private ne?: FakeV4Point

  constructor(sw?: FakeV4Point, ne?: FakeV4Point) {
    this.sw = sw
    this.ne = ne
  }

  isEmpty(): boolean {
    return !this.sw || !this.ne
  }

  clone(): FakeV4Bounds {
    return new FakeV4Bounds(this.sw?.clone(), this.ne?.clone())
  }

  extend(point: FakeV4Point): void {
    if (!this.sw || !this.ne) {
      this.sw = point.clone()
      this.ne = point.clone()
      return
    }
    this.sw = new FakeV4Point(Math.min(this.sw.lng, point.lng), Math.min(this.sw.lat, point.lat))
    this.ne = new FakeV4Point(Math.max(this.ne.lng, point.lng), Math.max(this.ne.lat, point.lat))
  }

  getSouthWest(): FakeV4Point | null {
    return this.sw ?? null
  }

  getNorthEast(): FakeV4Point | null {
    return this.ne ?? null
  }

  setSouthWest(sw: FakeV4Point): void {
    this.sw = sw
  }

  setNorthEast(ne: FakeV4Point): void {
    this.ne = ne
  }

  getCenter(): FakeV4Point | null {
    if (!this.sw || !this.ne) return null
    return new FakeV4Point((this.sw.lng + this.ne.lng) / 2, (this.sw.lat + this.ne.lat) / 2)
  }

  containsPoint(point: FakeV4Point): boolean {
    // 官方实现没有空范围保护，空范围上调用会抛错——fake 保留这一行为
    if (this.isEmpty()) {
      throw new Error("Invalid bounds state: containsPoint on empty bounds")
    }
    return (
      point.lng >= this.sw!.lng &&
      point.lng <= this.ne!.lng &&
      point.lat >= this.sw!.lat &&
      point.lat <= this.ne!.lat
    )
  }

  toSpan(): FakeV4Size & { lng: number; lat: number } {
    const lng = this.sw && this.ne ? this.ne.lng - this.sw.lng : 0
    const lat = this.sw && this.ne ? this.ne.lat - this.sw.lat : 0
    const span = new FakeV4Size(lng, lat) as FakeV4Size & { lng: number; lat: number }
    span.lng = lng
    span.lat = lat
    return span
  }
}
