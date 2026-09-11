/**
 * MapDriver
 *
 * 只纳入组件和高频业务真正需要的能力；高级能力(动画/截图/室内)
 * 不直接膨胀 MapDriver，后续按需分子 facet。
 */
import type { MapHandle } from "./handles";
import type { Bounds, Pixel, Point, Size } from "./geometry";

export type MapType = "normal" | "satellite" | "earth";

export type MapInteraction =
  | "dragging"
  | "scroll-zoom"
  | "inertial-dragging"
  | "pinch-zoom"
  | "keyboard"
  | "double-click-zoom"
  | "continuous-zoom"
  | "resize-on-center"
  | "rotate"
  | "rotate-gestures"
  | "tilt"
  | "tilt-gestures";

export type MapStyleInput = { styleId: string } | Record<string, unknown>;

export interface InitialMapOptions {
  minZoom?: number;
  maxZoom?: number;
  backgroundColor?: number[];
  restrictCenter?: boolean;
  displayOptions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MapView {
  center: Point | string;
  zoom: number;
  heading?: number;
  tilt?: number;
}

export interface MapDriver {
  create(container: HTMLElement, options?: InitialMapOptions): MapHandle;
  /**
   * 销毁地图并释放 Driver 侧业务资源（订阅分组、动画引用）。
   *
   * 契约要求：
   * - **幂等**：对同一 Handle 重复调用不抛错、不重复释放；
   * - 销毁后对该 map 的其它命令应被拒绝（`BMAP_RESOURCE_DISPOSED`）。
   *
   * v4 实现（`driver/jsapi-v4/map.ts`）遵守以上两条；迁移期 `webgl-v1` 实现只保证幂等，
   * 未校验销毁后的命令（属待删除实现，见 ADR 2026-09-11-jsapi-v4-map-facet）。
   */
  destroy(map: MapHandle): void;

  initializeView(map: MapHandle, view: MapView): void;

  setCenter(map: MapHandle, center: Point | string): void;
  getCenter(map: MapHandle): Point;

  setZoom(map: MapHandle, zoom: number): void;
  getZoom(map: MapHandle): number;

  setHeading(map: MapHandle, heading: number): void;
  getHeading(map: MapHandle): number;

  setTilt(map: MapHandle, tilt: number): void;
  getTilt(map: MapHandle): number;

  getBounds(map: MapHandle): Bounds;
  getSize(map: MapHandle): Size;

  /** 经纬度 → 屏幕像素（v4 `pointToPixel`；不传 options，按当前地图状态换算） */
  pointToPixel(map: MapHandle, point: Point): Pixel;
  /** 屏幕像素 → 经纬度（v4 `pixelToPoint`；不传 options，按当前地图状态换算） */
  pixelToPoint(map: MapHandle, pixel: Pixel): Point;

  panTo(map: MapHandle, point: Point): void;
  panBy(map: MapHandle, pixel: Pixel): void;
  fitBounds(map: MapHandle, bounds: Bounds): void;
  /** 按若干点设置视口（getViewport/setViewport；缺失时退化为中心点 centerAndZoom） */
  setViewport(map: MapHandle, points: readonly Point[], options?: Record<string, unknown>): void;
  checkResize(map: MapHandle): void;

  setMapType(map: MapHandle, type: MapType): void;
  setMapStyle(map: MapHandle, style: MapStyleInput): void;
  setInteraction(map: MapHandle, name: MapInteraction, enabled: boolean): void;
  setTraffic(map: MapHandle, enabled: boolean): void;

  startViewAnimation(map: MapHandle, animation: unknown): void;
  stopViewAnimation(map: MapHandle): void;
}
