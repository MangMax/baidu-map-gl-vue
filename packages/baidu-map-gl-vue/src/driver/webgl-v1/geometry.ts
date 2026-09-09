/**
 * webgl-v1 GeometryDriver
 */
import { BMapError } from "../../core/errors/BMapError";
import type { GeometryDriver } from "../types/geometry";
import { callOptional, sdkCall, sdkCtor } from "./internal";

export function createWebGlV1GeometryDriver(rawSdk: unknown): GeometryDriver {
  return {
    toRawPoint(point) {
      return sdkCall("Point", () => new (sdkCtor(rawSdk, "Point"))(point.lng, point.lat));
    },

    fromRawPoint(raw) {
      const p = raw as { lng: number; lat: number } | null | undefined;
      if (!p || typeof p.lng !== "number" || typeof p.lat !== "number") {
        throw new BMapError("BMAP_INVALID_POINT", "raw point is not a valid Point");
      }
      return { lng: p.lng, lat: p.lat };
    },

    toRawPoints(points) {
      return points.map((point) => this.toRawPoint(point));
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
