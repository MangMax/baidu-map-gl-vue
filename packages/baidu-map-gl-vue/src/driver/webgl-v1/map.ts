/**
 * webgl-v1 MapDriver
 */
import { createHandle, type MapHandle, type SdkHandle } from "../types/handles";
import type { GeometryDriver } from "../types/geometry";
import type {
  MapDriver,
  MapInteraction,
  MapType,
  MapView,
} from "../types/map";
import { callOptional, sdkCall, sdkCtor } from "./internal";

const SDK_MAP_TYPES: Record<MapType, string> = {
  normal: "B_NORMAL_MAP",
  satellite: "B_SATELLITE_MAP",
  earth: "B_EARTH_MAP",
};

const INTERACTIONS: Record<
  MapInteraction,
  { enable: string; disable: string }
> = {
  dragging: { enable: "enableDragging", disable: "disableDragging" },
  "scroll-zoom": { enable: "enableScrollWheelZoom", disable: "disableScrollWheelZoom" },
  "inertial-dragging": { enable: "enableInertialDragging", disable: "disableInertialDragging" },
  "pinch-zoom": { enable: "enablePinchToZoom", disable: "disablePinchToZoom" },
  keyboard: { enable: "enableKeyboard", disable: "disableKeyboard" },
  "double-click-zoom": { enable: "enableDoubleClickZoom", disable: "disableDoubleClickZoom" },
  "continuous-zoom": { enable: "enableContinuousZoom", disable: "disableContinuousZoom" },
  "resize-on-center": { enable: "enableResizeOnCenter", disable: "disableResizeOnCenter" },
  rotate: { enable: "enableRotate", disable: "disableRotate" },
  "rotate-gestures": { enable: "enableRotateGestures", disable: "disableRotateGestures" },
  tilt: { enable: "enableTilt", disable: "disableTilt" },
  "tilt-gestures": { enable: "enableTiltGestures", disable: "disableTiltGestures" },
};

export interface WebGlV1MapDriverInput {
  rawSdk: unknown;
  geometry: GeometryDriver;
}

export function createWebGlV1MapDriver(input: WebGlV1MapDriverInput): MapDriver {
  const { rawSdk, geometry } = input;

  const toRawCenter = (center: MapView["center"]): unknown =>
    typeof center === "string" ? center : geometry.toRawPoint(center);

  return {
    create(container, options) {
      const map = sdkCall("Map", () =>
        new (sdkCtor(rawSdk, "Map"))(container, options as Record<string, unknown> | undefined),
      );
      return createHandle("map", map);
    },

    destroy(map) {
      callOptional(map.raw, "destroy");
    },

    initializeView(map, view) {
      const raw = map.raw as {
        centerAndZoom?: (center: unknown, zoom: number) => void;
        setView?: (center: unknown, zoom: number) => void;
        setHeading?: (heading: number) => void;
        setTilt?: (tilt: number) => void;
      };
      const center = toRawCenter(view.center);
      if (raw.setView) sdkCall("map.setView", () => raw.setView!(center, view.zoom));
      else sdkCall("map.centerAndZoom", () => raw.centerAndZoom!(center, view.zoom));
      if (view.heading != null) callOptional(raw, "setHeading", view.heading);
      if (view.tilt != null) callOptional(raw, "setTilt", view.tilt);
    },

    setCenter(map, center) {
      callOptional(map.raw, "setCenter", toRawCenter(center));
    },

    getCenter(map) {
      const raw = map.raw as { getCenter?: () => { lng: number; lat: number } };
      return geometry.fromRawPoint(sdkCall("map.getCenter", () => raw.getCenter!()));
    },

    setZoom(map, zoom) {
      callOptional(map.raw, "setZoom", zoom);
    },

    getZoom(map) {
      const raw = map.raw as { getZoom?: () => number };
      return sdkCall("map.getZoom", () => raw.getZoom!());
    },

    setHeading(map, heading) {
      callOptional(map.raw, "setHeading", heading);
    },

    getHeading(map) {
      const raw = map.raw as { getHeading?: () => number };
      return sdkCall("map.getHeading", () => raw.getHeading!());
    },

    setTilt(map, tilt) {
      callOptional(map.raw, "setTilt", tilt);
    },

    getTilt(map) {
      const raw = map.raw as { getTilt?: () => number };
      return sdkCall("map.getTilt", () => raw.getTilt!());
    },

    getBounds(map) {
      const raw = map.raw as { getBounds?: () => unknown };
      return geometry.fromRawBounds(sdkCall("map.getBounds", () => raw.getBounds!()));
    },

    getSize(map) {
      const raw = map.raw as { getSize?: () => unknown };
      return geometry.fromRawSize(sdkCall("map.getSize", () => raw.getSize!()));
    },

    panTo(map, point) {
      callOptional(map.raw, "panTo", geometry.toRawPoint(point));
    },

    panBy(map, pixel) {
      callOptional(map.raw, "panBy", geometry.toRawPixel(pixel));
    },

    fitBounds(map, bounds) {
      callOptional(map.raw, "fitBounds", geometry.toRawBounds(bounds));
    },

    setViewport(map, points, options) {
      const raw = map.raw as {
        getViewport?: (points: unknown[]) => unknown;
        setViewport?: (viewport: unknown, options?: unknown) => void;
        centerAndZoom?: (center: unknown, zoom: number) => void;
      };
      const rawPoints = points.map((point) => geometry.toRawPoint(point));
      if (typeof raw.getViewport === "function" && typeof raw.setViewport === "function") {
        const viewport = sdkCall("map.getViewport", () => raw.getViewport!(rawPoints));
        callOptional(raw, "setViewport", viewport, options ?? {});
        return;
      }
      if (typeof raw.centerAndZoom === "function") {
        const bounds = geometry.toRawBounds({
          southwest: points[0] ?? { lng: 0, lat: 0 },
          northeast: points[points.length - 1] ?? { lng: 0, lat: 0 },
        });
        const center = (bounds as { getCenter?: () => { lng: number; lat: number } }).getCenter?.();
        if (center) sdkCall("map.centerAndZoom", () => raw.centerAndZoom!(geometry.toRawPoint(center), 16));
      }
    },

    checkResize(map) {
      callOptional(map.raw, "checkResize");
    },

    setMapType(map, type) {
      callOptional(map.raw, "setMapType", SDK_MAP_TYPES[type] ?? SDK_MAP_TYPES.normal);
    },

    setMapStyle(map, style) {
      callOptional(map.raw, "setMapStyleV2", style as Record<string, unknown>);
    },

    setInteraction(map, name, enabled) {
      const methods = INTERACTIONS[name];
      if (!methods) return;
      callOptional(map.raw, enabled ? methods.enable : methods.disable);
    },

    setTraffic(map, enabled) {
      callOptional(map.raw, enabled ? "setTrafficOn" : "setTrafficOff");
    },

    startViewAnimation(map, animation) {
      const raw = animation as SdkHandle<string>;
      callOptional(map.raw, "startViewAnimation", raw.raw);
    },

    stopViewAnimation(map) {
      callOptional(map.raw, "stopViewAnimation");
    },
  };
}
