/**
 * OverlayDriver
 *
 * 覆盖物构造器与字段级 setter 全部收进 Driver；组件只传领域值对象。
 * 具体 SDK 不支持的能力由 Capability 控制，Driver 不静默吞错。
 */
import type {
  CircleHandle,
  InfoWindowHandle,
  LabelHandle,
  MapHandle,
  MarkerHandle,
  OverlayHandle,
  PolygonHandle,
  PolylineHandle,
  SdkHandle,
} from "./handles";
import type { Bounds, Pixel, Point, Size } from "./geometry";

export type OverlayKind =
  | "marker"
  | "polyline"
  | "polygon"
  | "circle"
  | "info-window"
  | "label"
  | "prism"
  | "marker3d"
  | "bezier-curve"
  | "map-mask"
  | "ground-overlay"
  | "context-menu";

/** Marker 图标：内置名称或自定义图标描述 */
export type MarkerIconInput =
  | string
  | {
      imageUrl: string;
      size: Size;
      anchor?: Pixel;
      imageOffset?: Pixel;
      imageSize?: Size;
      printImageUrl?: string;
    };

export interface MarkerOptions {
  offset?: Pixel;
  title?: string;
  icon?: MarkerIconInput;
  zIndex?: number;
  rotation?: number;
  enableClicking?: boolean;
  enableDragging?: boolean;
  [key: string]: unknown;
}

export interface PathOptions {
  strokeColor?: string;
  strokeWeight?: number;
  strokeOpacity?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  fillColor?: string;
  fillOpacity?: number;
  enableMassClear?: boolean;
  enableEditing?: boolean;
  [key: string]: unknown;
}

export interface InfoWindowOptions {
  width?: number;
  height?: number;
  title?: string;
  offset?: Pixel;
  enableMaximize?: boolean;
  enableAutoPan?: boolean;
  enableCloseOnClick?: boolean;
  [key: string]: unknown;
}

export interface LabelOptions {
  position?: Point;
  offset?: Pixel;
  zIndex?: number;
  style?: Record<string, unknown>;
  enableMassClear?: boolean;
  [key: string]: unknown;
}

export interface OverlayTarget {
  kind: "map" | "marker" | "clusterer" | "overlay";
  handle: SdkHandle<string>;
}

export interface OverlayDriver {
  createMarker(position: Point, options?: MarkerOptions): MarkerHandle;
  createPolyline(path: readonly Point[], options?: PathOptions): PolylineHandle;
  /** isBoundary 时允许 SDK 原生字符串路径（如边界名称） */
  createPolygon(path: readonly (Point | string)[], options?: PathOptions & { isBoundary?: boolean }): PolygonHandle;
  createCircle(center: Point, radius: number, options?: PathOptions): CircleHandle;
  createInfoWindow(content: HTMLElement, options?: InfoWindowOptions): InfoWindowHandle;
  createLabel(content: string, options?: LabelOptions): LabelHandle;
  /** isBoundary 时允许 SDK 原生字符串路径 */
  createPrism(path: readonly (Point | string)[], altitude: number, options?: Record<string, unknown>): OverlayHandle;
  createMarker3D(position: Point, height: number, options?: Record<string, unknown>): OverlayHandle;
  createBezierCurve(
    path: readonly Point[],
    controlPoints: readonly (readonly Point[])[],
    options?: Record<string, unknown>,
  ): OverlayHandle;
  createMapMask(path: readonly Point[], options?: Record<string, unknown>): OverlayHandle;
  createGroundOverlay(bounds: Bounds, options?: Record<string, unknown>): OverlayHandle;
  createContextMenu(options?: { width?: number }): OverlayHandle;
  addContextMenuItem(
    menu: OverlayHandle,
    item: { text: string; callback: (point: unknown, pixel: unknown) => void; disabled?: boolean } | "-",
    options?: { width?: number },
  ): void;

  add(target: OverlayTarget, overlay: OverlayHandle): void;
  remove(target: OverlayTarget, overlay: OverlayHandle): void;

  /** 优先 SDK show/hide；返回是否真正应用（无 show/hide 能力时返回 false） */
  show(overlay: OverlayHandle): boolean;
  hide(overlay: OverlayHandle): boolean;

  attachContextMenu(target: OverlayTarget, menu: OverlayHandle): void;
  detachContextMenu(target: OverlayTarget, menu: OverlayHandle): void;

  setPosition(overlay: OverlayHandle, position: Point): void;
  setPath(overlay: OverlayHandle, path: readonly (Point | string)[]): void;
  setOptions(overlay: OverlayHandle, options: Record<string, unknown>): void;

  openInfoWindow(map: MapHandle, overlay: InfoWindowHandle, position?: Point): void;
  closeInfoWindow(overlay: InfoWindowHandle): void;
  redrawInfoWindow(overlay: InfoWindowHandle): void;

  /** 构建 Marker Icon（供 useBMapMarkerIcons 等业务复用） */
  buildIcon(icon: MarkerIconInput): unknown;
}

export type MapTarget = { kind: "map"; handle: MapHandle };
