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
