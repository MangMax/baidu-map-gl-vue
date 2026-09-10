/**
 * Driver 工厂与 engine 探测
 */
import { BMapError } from "../core/errors/BMapError";
import type { Capability } from "./capability/catalog";
import type { UnsupportedBehavior } from "./capability/unsupported";
import type { BMapDriver, BMapEngine } from "./types/bmap";
import { createWebGlV1Driver, detectVersion } from "./webgl-v1/createDriver";

export interface CreateDriverInput {
  engine: BMapEngine;
  rawSdk: unknown;
  unsupported?: UnsupportedBehavior;
  capabilityOverrides?: Partial<Record<Capability, boolean>>;
}

/** 从已加载的 SDK namespace 探测 engine */
export function detectEngine(loaded: unknown): BMapEngine {
  const sdk = loaded as Record<string, unknown> | null | undefined;
  if (!sdk) return "jsapi-v4";
  if (typeof sdk.Map === "function" && typeof sdk.Point === "function") return "webgl-v1";
  if (typeof sdk.BMap === "function" || typeof sdk.MapGL === "function") return "jsapi-v3";
  const version = typeof sdk.VERSION === "string" ? sdk.VERSION : "";
  if (/v4|4\./i.test(version)) return "jsapi-v4";
  return "webgl-v1";
}

export function createDriver(input: CreateDriverInput): BMapDriver {
  switch (input.engine) {
    case "webgl-v1":
      return createWebGlV1Driver({
        rawSdk: input.rawSdk,
        unsupported: input.unsupported ?? "warn",
        capabilityOverrides: input.capabilityOverrides,
      });
    case "jsapi-v3":
    case "jsapi-v4":
      throw new BMapError(
        "BMAP_CAPABILITY_UNSUPPORTED",
        `${input.engine} driver is not implemented yet; only webgl-v1 is stable in this release`,
        { engine: input.engine },
      );
    default:
      return assertNever(input.engine);
  }
}

function assertNever(value: never): never {
  throw new BMapError("BMAP_CAPABILITY_UNSUPPORTED", `Unknown engine: ${String(value)}`);
}

export { detectVersion };
export * from "./types/handles";
export * from "./types/geometry";
export type { MapType, MapInteraction, MapStyleInput, InitialMapOptions, MapView, MapDriver } from "./types/map";
export type {
  OverlayKind,
  MarkerIconInput,
  MarkerOptions,
  PathOptions,
  InfoWindowOptions,
  LabelOptions,
  OverlayTarget,
  OverlayDriver,
} from "./types/overlays";
export type { ControlKind, ControlOptions, CopyrightEntry, ControlDriver } from "./types/controls";
export type { LayerKind, LayerDriver } from "./types/layers";
export type { AutocompleteOptions, ServiceDriver } from "./types/services";
export type { PanoramaDriver } from "./types/panorama";
export type { MapMouseEvent, EventDriver } from "./types/events";
export type { BMapDriver, BMapEngine } from "./types/bmap";
export type {
  Capability,
  CapabilityDescriptor,
  CapabilityExplanation,
  CapabilityFamily,
  CapabilityReason,
  CapabilityRegistry,
  CapabilityStatus,
} from "./capability";
export {
  CAPABILITY_CATALOG,
  CAPABILITY_FAMILIES,
  CAPABILITY_IDS,
  CAPABILITY_STATUSES,
  createCapabilityRegistry,
  UnsupportedCapabilityError,
} from "./capability";
export type { UnsupportedBehavior } from "./capability";
export { normalizeMapMouseEvent, toPoint, isPointLike, toPlainPoint, toPlainPoints } from "./normalize";
