/**
 * webgl-v1 ServiceDriver
 *
 * SDK 服务类统一创建；业务层通过 ServiceHandle 使用。
 * TrackAnimation 依赖插件构造器，缺失时抛 BMAP_PLUGIN_LOAD_FAILED（由插件注册表负责加载）。
 */
import { BMapError } from "../../core/errors/BMapError";
import { createHandle, type MapHandle } from "../types/handles";
import type { AutocompleteOptions, ServiceDriver } from "../types/services";
import type { GeometryDriver } from "../types/geometry";
import { sdkCall, sdkCtor } from "./internal";

export interface WebGlV1ServiceDriverInput {
  rawSdk: unknown;
  geometry: GeometryDriver;
}

function normalizeLocation(rawSdk: unknown, location: unknown): unknown {
  if (location && typeof location === "object") {
    const maybe = location as { raw?: unknown; lng?: unknown; lat?: unknown };
    if ("raw" in maybe) return maybe.raw;
    if (typeof maybe.lng === "number" && typeof maybe.lat === "number") {
      return new (sdkCtor(rawSdk, "Point"))(maybe.lng, maybe.lat);
    }
  }
  return location;
}

export function createWebGlV1ServiceDriver(input: WebGlV1ServiceDriverInput): ServiceDriver {
  const { rawSdk, geometry } = input;

  return {
    createGeocoder() {
      const Geocoder = sdkCtor(rawSdk, "Geocoder");
      return createHandle("service:geocoder", sdkCall("Geocoder", () => new Geocoder()));
    },

    createConvertor() {
      const Convertor = sdkCtor(rawSdk, "Convertor");
      return createHandle("service:convertor", sdkCall("Convertor", () => new Convertor()));
    },

    createGeolocation(options = {}) {
      const Geolocation = sdkCtor(rawSdk, "Geolocation");
      return createHandle(
        "service:geolocation",
        sdkCall("Geolocation", () => new Geolocation(options)),
      );
    },

    createLocalCity() {
      const LocalCity = sdkCtor(rawSdk, "LocalCity");
      return createHandle("service:local-city", sdkCall("LocalCity", () => new LocalCity()));
    },

    createBoundary() {
      const Boundary = sdkCtor(rawSdk, "Boundary");
      return createHandle("service:boundary", sdkCall("Boundary", () => new Boundary()));
    },

    createAutocomplete(options: AutocompleteOptions) {
      const Autocomplete = sdkCtor(rawSdk, "Autocomplete");
      const location = normalizeLocation(rawSdk, options.location);
      const instance = sdkCall("Autocomplete", () =>
        new Autocomplete({
          location,
          input: options.input,
          types: options.types,
          onSearchComplete: options.onSearchComplete,
        }),
      );
      return createHandle("service:autocomplete", instance);
    },

    createViewAnimation(keyFrames, options = {}) {
      const ViewAnimation = sdkCtor(rawSdk, "ViewAnimation");
      const frames = keyFrames.map((frame) => ({
        ...frame,
        center:
          typeof frame.center === "object" && frame.center
            ? geometry.toRawPoint(frame.center as { lng: number; lat: number })
            : frame.center,
      }));
      const anim = sdkCall("ViewAnimation", () =>
        new ViewAnimation(frames, {
          duration: options.duration ?? 1000,
          delay: options.delay ?? 0,
          interation: options.loop ?? 1,
        }),
      );
      return createHandle("service:view-animation", anim);
    },

    createTrackAnimation(map: MapHandle, path, options = {}) {
      const TrackAnimationCtor =
        (rawSdk as { TrackAnimation?: unknown }).TrackAnimation ??
        (typeof globalThis !== "undefined"
          ? (globalThis as { BMapGLLib?: { TrackAnimation?: unknown } }).BMapGLLib?.TrackAnimation
          : undefined);
      if (typeof TrackAnimationCtor !== "function") {
        throw new BMapError(
          "BMAP_PLUGIN_LOAD_FAILED",
          "TrackAnimation plugin is not ready. Add plugins=['TrackAnimation'] to BMap.",
        );
      }
      const Polyline = sdkCtor(rawSdk, "Polyline");
      const polyline = sdkCall("Polyline", () =>
        new Polyline(geometry.toRawPoints(path), {
          strokeColor: "#1677ff",
          strokeWeight: 5,
          strokeOpacity: 0.9,
        }),
      );
      const animation = sdkCall("TrackAnimation", () =>
        new (TrackAnimationCtor as new (...args: unknown[]) => unknown)(
          map.raw,
          polyline,
          options,
        ),
      );
      return createHandle("service:track-animation", animation);
    },
  };
}
