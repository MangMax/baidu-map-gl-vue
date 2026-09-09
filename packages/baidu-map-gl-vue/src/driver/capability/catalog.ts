/**
 * Capability Catalog
 *
 * 语义能力名 → 描述符。rawMembers 指向 SDK 顶层构造器名或 Map 原型方法名，
 * 用于在无真实 SDK 的测试/离线环境做能力探测。
 */
import type { BMapEngine } from "../types/bmap";

export type Capability =
  | "map.heading"
  | "map.tilt"
  | "map.fly-to"
  | "map.screenshot"
  | "map.check-resize"
  | "overlay.marker"
  | "overlay.info-window"
  | "overlay.rectangle"
  | "overlay.custom-dom"
  | "overlay.point-collection"
  | "layer.geojson"
  | "layer.traffic"
  | "layer.point-icon"
  | "layer.point-shape"
  | "service.local-search"
  | "service.driving-route"
  | "service.walking-route"
  | "service.riding-route"
  | "service.transit-route"
  | "service.truck-route"
  | "panorama.viewer"
  | "panorama.service";

export interface CapabilityFallback {
  /** 语义能力在旧版本上的替代成员名（如 fly-to → panTo） */
  via?: string;
}

export interface CapabilityDescriptor {
  id: Capability;
  rawMembers?: readonly string[];
  engines: readonly BMapEngine[];
  fallback?: CapabilityFallback;
}

const WEBGL_ONLY: readonly BMapEngine[] = ["webgl-v1"];
const ALL: readonly BMapEngine[] = ["webgl-v1", "jsapi-v3", "jsapi-v4"];
const WEBGL_V4: readonly BMapEngine[] = ["webgl-v1", "jsapi-v4"];

export const CAPABILITY_CATALOG: Record<Capability, CapabilityDescriptor> = {
  "map.heading": { id: "map.heading", rawMembers: ["setHeading"], engines: WEBGL_ONLY },
  "map.tilt": { id: "map.tilt", rawMembers: ["setTilt"], engines: WEBGL_ONLY },
  "map.fly-to": { id: "map.fly-to", rawMembers: ["panTo"], engines: ALL, fallback: { via: "panTo" } },
  "map.screenshot": { id: "map.screenshot", rawMembers: ["getScreenshot"], engines: WEBGL_V4 },
  "map.check-resize": { id: "map.check-resize", rawMembers: ["checkResize"], engines: ALL },
  "overlay.marker": { id: "overlay.marker", rawMembers: ["Marker"], engines: ALL },
  "overlay.info-window": { id: "overlay.info-window", rawMembers: ["InfoWindow"], engines: ALL },
  "overlay.rectangle": { id: "overlay.rectangle", rawMembers: ["Rectangle"], engines: WEBGL_V4 },
  "overlay.custom-dom": { id: "overlay.custom-dom", rawMembers: ["CustomOverlay"], engines: WEBGL_V4 },
  "overlay.point-collection": {
    id: "overlay.point-collection",
    rawMembers: ["PointCollection"],
    engines: WEBGL_V4,
  },
  "layer.geojson": { id: "layer.geojson", rawMembers: ["GeoJson"], engines: WEBGL_V4 },
  "layer.traffic": { id: "layer.traffic", rawMembers: ["TrafficLayer"], engines: ALL },
  "layer.point-icon": { id: "layer.point-icon", rawMembers: ["PointIconLayer"], engines: WEBGL_V4 },
  "layer.point-shape": { id: "layer.point-shape", rawMembers: ["PointShapeLayer"], engines: WEBGL_V4 },
  "service.local-search": { id: "service.local-search", rawMembers: ["LocalSearch"], engines: ALL },
  "service.driving-route": { id: "service.driving-route", rawMembers: ["DrivingRoute"], engines: ALL },
  "service.walking-route": { id: "service.walking-route", rawMembers: ["WalkingRoute"], engines: ALL },
  "service.riding-route": { id: "service.riding-route", rawMembers: ["RidingRoute"], engines: ALL },
  "service.transit-route": { id: "service.transit-route", rawMembers: ["TransitRoute"], engines: ALL },
  "service.truck-route": { id: "service.truck-route", rawMembers: ["TruckRoute"], engines: WEBGL_V4 },
  "panorama.viewer": { id: "panorama.viewer", rawMembers: ["Panorama"], engines: WEBGL_V4 },
  "panorama.service": { id: "panorama.service", rawMembers: ["PanoramaService"], engines: WEBGL_V4 },
};

export const CAPABILITY_IDS = Object.keys(CAPABILITY_CATALOG) as readonly Capability[];
