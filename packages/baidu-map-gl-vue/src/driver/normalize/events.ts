/**
 * 事件归一化：把 raw SDK 事件转为组件库事件形状。
 * 不修改原始 SDK event 对象。
 */
import type { GeometryDriver } from "../types/geometry";
import type { MapMouseEvent } from "../types/events";
import type { Pixel, Point } from "../types/geometry";

export function normalizeMapMouseEvent(
  raw: unknown,
  geometry: GeometryDriver,
): MapMouseEvent {
  const r = raw as {
    point?: unknown;
    pixel?: unknown;
    domEvent?: Event;
  };
  const rawPoint = r?.point;
  const point: Point = rawPoint
    ? geometry.fromRawPoint(rawPoint)
    : (() => {
        const maybe = raw as { lng?: number; lat?: number };
        if (typeof maybe?.lng === "number" && typeof maybe?.lat === "number") {
          return { lng: maybe.lng, lat: maybe.lat };
        }
        return { lng: 0, lat: 0 };
      })();
  const pixel: Pixel | undefined = r?.pixel ? geometry.fromRawPixel(r.pixel) : undefined;
  const domEvent = r?.domEvent;
  return {
    point,
    pixel,
    domEvent,
    raw,
    preventDefault: () => domEvent?.preventDefault?.(),
    stopPropagation: () => domEvent?.stopPropagation?.(),
  };
}
