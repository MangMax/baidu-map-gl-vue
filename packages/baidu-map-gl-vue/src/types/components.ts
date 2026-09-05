/**
 * 组件公共 Props 类型(与各 SFC `export interface XxxProps` 对齐)
 *
 * 说明:
 * - SFC 内 `defineProps<XxxProps>()` 使用此处类型(单一来源)。
 * - 根入口从此文件导出,避免从 `*.vue` 导出类型(TS 无法在纯 tsc 下解析 .vue 具名命名导出)。
 * - 精确的组件实例类型仍由 Volar 从 SFC 解析。
 */

export interface BMapProps {
  ak?: string;
  apiUrl?: string;
  provider?: { load(opts?: unknown, signal?: AbortSignal): Promise<unknown> };
  center?: { lng: number; lat: number } | string;
  zoom?: number;
  width?: string | number;
  height?: string | number;
  mapType?: string;
  heading?: number;
  tilt?: number;
  minZoom?: number;
  maxZoom?: number;
  noAnimation?: boolean;
  enableDragging?: boolean;
  enableScrollWheelZoom?: boolean;
  loadingBgColor?: string;
}

export interface BMarkerProps {
  position: { lng: number; lat: number };
  offset?: { x: number; y: number };
  zIndex?: number;
  visible?: boolean;
  title?: string;
  enableDragging?: boolean;
  rotation?: number;
}

export interface BInfoWindowProps {
  position?: { lng: number; lat: number };
  title?: string;
  width?: number;
  height?: number;
  offset?: { x: number; y: number };
  open?: boolean;
}

export interface BCircleProps {
  center: { lng: number; lat: number };
  radius: number;
  strokeColor?: string;
  strokeWeight?: number;
  strokeOpacity?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  fillColor?: string;
  fillOpacity?: number;
  enableMassClear?: boolean;
  enableEditing?: boolean;
  enableClicking?: boolean;
  visible?: boolean;
}

export interface BPolylineProps {
  path: { lng: number; lat: number }[];
  pathVersion?: string | number;
  strokeColor?: string;
  strokeWeight?: number;
  strokeOpacity?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  enableMassClear?: boolean;
  enableEditing?: boolean;
  visible?: boolean;
}
