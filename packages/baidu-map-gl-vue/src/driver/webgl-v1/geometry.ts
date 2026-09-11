/**
 * webgl-v1 GeometryDriver
 */
import { BMapError } from "../../core/errors/BMapError";
import type { GeometryDriver } from "../types/geometry";
import { callOptional, sdkCall, sdkCtor } from "./internal";

export function createWebGlV1GeometryDriver(rawSdk: unknown): GeometryDriver {
  // BD09MC 米制 → 度:优先 SDK 自带逆投影,缺失时用球面墨卡托近似兜底
  const mcToDegrees = (x: number, y: number): { lng: number; lat: number } => {
    try {
      const projection = (
        rawSdk as {
          MercatorProjection?: {
            convertMC2LL?: (point: { lng: number; lat: number }) => { lng: number; lat: number };
          };
        }
      )?.MercatorProjection;
      const converted = projection?.convertMC2LL?.({ lng: x, lat: y });
      if (
        converted &&
        typeof converted.lng === "number" &&
        typeof converted.lat === "number" &&
        Number.isFinite(converted.lng) &&
        Number.isFinite(converted.lat)
      ) {
        return { lng: converted.lng, lat: converted.lat };
      }
    } catch {
      /* 掉入近似公式 */
    }
    const lng = (x / 20037508.34) * 180;
    const lat =
      (180 / Math.PI) * (2 * Math.atan(Math.exp(((y / 20037508.34) * 180 * Math.PI) / 180)) - Math.PI / 2);
    return { lng, lat };
  };

  return {
    toRawPoint(point) {
      return sdkCall("Point", () => new (sdkCtor(rawSdk, "Point"))(point.lng, point.lat));
    },

    fromRawPoint(raw) {
      const p = raw as { lng: number; lat: number } | null | undefined;
      if (
        !p ||
        typeof p.lng !== "number" ||
        typeof p.lat !== "number" ||
        !Number.isFinite(p.lng) ||
        !Number.isFinite(p.lat)
      ) {
        throw new BMapError("BMAP_INVALID_POINT", "raw point is not a valid Point");
      }
      // WebGL 渲染路径下部分事件点位(如地图 click)为 BD09MC 米制;
      // 超出经纬度取值范围的一律逆投影为度,避免镜头飞走与解析失败。
      if (Math.abs(p.lng) > 180 || Math.abs(p.lat) > 90) {
        return mcToDegrees(p.lng, p.lat);
      }
      return { lng: p.lng, lat: p.lat };
    },

    toRawPoints(points) {
      return points.map((point) => this.toRawPoint(point));
    },

    fromRawPoints(raws) {
      return raws.map((raw) => this.fromRawPoint(raw));
    },

    toRawPixel(pixel) {
      return callOptional(rawSdk, "Pixel")
        ? sdkCall("Pixel", () => new (sdkCtor(rawSdk, "Pixel"))(pixel.x, pixel.y))
        : { x: pixel.x, y: pixel.y };
    },

    fromRawPixel(raw) {
      const p = raw as { x: number; y: number };
      return { x: p.x, y: p.y };
    },

    toRawSize(size) {
      return sdkCall("Size", () => new (sdkCtor(rawSdk, "Size"))(size.width, size.height));
    },

    fromRawSize(raw) {
      const s = raw as { width: number; height: number };
      return { width: s.width, height: s.height };
    },

    toRawBounds(bounds) {
      return sdkCall(
        "Bounds",
        () =>
          new (sdkCtor(rawSdk, "Bounds"))(
            new (sdkCtor(rawSdk, "Point"))(bounds.southwest.lng, bounds.southwest.lat),
            new (sdkCtor(rawSdk, "Point"))(bounds.northeast.lng, bounds.northeast.lat),
          ),
      );
    },

    fromRawBounds(raw) {
      const b = raw as {
        getSouthWest?: () => { lng: number; lat: number };
        getNorthEast?: () => { lng: number; lat: number };
      };
      if (typeof b.getSouthWest !== "function" || typeof b.getNorthEast !== "function") {
        throw new BMapError("BMAP_INVALID_ARGUMENT", "raw bounds is not a valid Bounds");
      }
      return { southwest: b.getSouthWest(), northeast: b.getNorthEast() };
    },
  };
}
