/**
 * 事件归一化：把 raw SDK 事件转为组件库事件形状。
 * 不修改原始 SDK event 对象。
 *
 * 两个入口：
 * - `normalizeMapMouseEvent`：指针类事件 → `MapMouseEvent`（`point` 必有，历史行为保留）；
 * - `normalizeDriverEvent`：任意 map/overlay/layer 事件 → `DriverEvent`（缺失字段留空 +
 *   `raw` 逃生口），供 v4 EventDriver 在派发前统一调用。
 *
 * 容错口径：事件链路由 SDK 驱动，归一化**不允许**把异常抛回 SDK 的 dispatch——那会中断
 * 同一次事件里其它监听器，甚至影响整张地图。因此这里用 `isPairLike` 作为**唯一**前置闸门：
 * 只有具备有限 `lng/lat`（或 `x/y` / `width/height`）形状的 raw 值才会交给 `GeometryDriver`，
 * 而驱动只拒绝非有限数 / 缺分量，所以调用点不会抛错——既不依赖 try/catch，也不吞掉真正的
 * 实现缺陷。raw 里坐标残缺或类型不对时字段缺失，需要原始数据走 `raw`。
 */
import type { GeometryDriver } from "../types/geometry";
import type { DriverEvent, MapMouseEvent } from "../types/events";
import type { Pixel, Point, Size } from "../types/geometry";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * raw 是否「看起来」是一个二维数值对象。
 *
 * 这是事件路径的归一化闸门：形状不对就直接跳过 `GeometryDriver`，避免把
 * 「raw 事件字段残缺」升级成「异常打断 SDK 事件派发」。
 */
function isPairLike(value: unknown, keys: readonly [string, string]): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isFiniteNumber(record[keys[0]]) && isFiniteNumber(record[keys[1]]);
}

function convertPoint(value: unknown, geometry: GeometryDriver): Point | undefined {
  return isPairLike(value, ["lng", "lat"]) ? geometry.fromRawPoint(value) : undefined;
}

function convertPixel(value: unknown, geometry: GeometryDriver): Pixel | undefined {
  return isPairLike(value, ["x", "y"]) ? geometry.fromRawPixel(value) : undefined;
}

function convertSize(value: unknown, geometry: GeometryDriver): Size | undefined {
  return isPairLike(value, ["width", "height"]) ? geometry.fromRawSize(value) : undefined;
}

interface EventBase {
  raw: unknown;
  domEvent?: Event;
  preventDefault(): void;
  stopPropagation(): void;
}

/** 共用基座：raw + DOM 事件代理（不修改原始 event 对象）。 */
function eventBase(raw: unknown): EventBase {
  const domEvent = (raw as { domEvent?: Event } | null | undefined)?.domEvent;
  return {
    raw,
    domEvent,
    preventDefault: () => domEvent?.preventDefault?.(),
    stopPropagation: () => domEvent?.stopPropagation?.(),
  };
}

export function normalizeMapMouseEvent(
  raw: unknown,
  geometry: GeometryDriver,
): MapMouseEvent {
  const shape = (raw ?? {}) as Record<string, unknown>;
  const point: Point =
    convertPoint(shape.point, geometry) ??
    (isFiniteNumber(shape.lng) && isFiniteNumber(shape.lat)
      ? { lng: shape.lng, lat: shape.lat }
      : { lng: 0, lat: 0 });
  return {
    ...eventBase(raw),
    point,
    pixel: convertPixel(shape.pixel, geometry),
  };
}

/**
 * 任意 map / overlay / layer 事件的归一化。
 *
 * `point` 优先取 `point`，其次 `latLng`：4.0 图形覆盖物事件两者都带，取值口径一致。
 */
export function normalizeDriverEvent(
  type: string,
  raw: unknown,
  geometry: GeometryDriver,
): DriverEvent {
  const shape = (raw ?? {}) as Record<string, unknown>;
  const rawType = typeof shape.type === "string" && shape.type ? shape.type : undefined;
  return {
    ...eventBase(raw),
    type: type || rawType,
    point: convertPoint(shape.point, geometry) ?? convertPoint(shape.latLng, geometry),
    pixel: convertPixel(shape.pixel, geometry),
    size: convertSize(shape.size, geometry),
    zoom: isFiniteNumber(shape.zoom) ? shape.zoom : undefined,
    targetZoom: isFiniteNumber(shape.targetZoom) ? shape.targetZoom : undefined,
  };
}
