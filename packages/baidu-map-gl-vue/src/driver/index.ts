/**
 * Driver 工厂与 engine 探测
 *
 * 注意（M3A1-CLIENT / issue #18）：`detectEngine` 是**运行时猜测**，默认 Client 路径
 * 已经不再使用它——Provider 必须返回结构化的 `LoadedSdk`（`engine` 判别字段），
 * 见 `client/createBMapClient.ts`。这里保留它只为 `./advanced` 的逃生口与历史调用方。
 */
import { BMapError } from "../core/errors/BMapError";
import type { Capability } from "./capability/catalog";
import type { UnsupportedBehavior } from "./capability/unsupported";
import { createJsapiV4Driver } from "./createJsapiV4Driver";
import type { BMapDriver, BMapEngine } from "./types/bmap";
import { createWebGlV1Driver, detectVersion } from "./webgl-v1/createDriver";

export { createJsapiV4Driver } from "./createJsapiV4Driver";
export type { CreateJsapiV4DriverInput } from "./createJsapiV4Driver";

export interface CreateDriverInput {
  engine: BMapEngine;
  rawSdk: unknown;
  unsupported?: UnsupportedBehavior;
  capabilityOverrides?: Partial<Record<Capability, boolean>>;
}

/** 从已加载的 SDK namespace 探测 engine（猜测式；默认 Client 路径不使用） */
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
    case "jsapi-v4":
      return createJsapiV4Driver({
        rawSdk: input.rawSdk,
        version: detectVersion(input.rawSdk),
        unsupported: input.unsupported ?? "warn",
        capabilityOverrides: input.capabilityOverrides,
      });
    case "jsapi-v3":
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
  CustomOverlayOptions,
  OverlayTarget,
  OverlayDriver,
  OverlayPropertyPolicy,
} from "./types/overlays";
export type { ControlKind, ControlOptions, CopyrightEntry, ControlDriver } from "./types/controls";
export type { LayerKind, LayerDriver } from "./types/layers";
export type {
  NativeLayerData,
  NativeLayerDriver,
  NativeLayerFeatureKeys,
  NativeLayerFeatureState,
  NativeLayerHandle,
  NativeLayerKind,
  NativeLayerOperation,
  NativeLayerPick,
  NativeLayerZoomRange,
} from "./types/native-layers";
export type {
  AutocompleteOptions,
  BoundaryRequest,
  ConvertorRequest,
  CoordinateFromType,
  CoordinateToType,
  GeocodeRequest,
  GeocodedAddress,
  GeolocationAddressInfo,
  GeolocationFix,
  GeolocationOptions,
  JsapiV4ServiceDriver,
  LocalCityFix,
  PlaceSuggestion,
  ReverseGeocodeRequest,
  ServiceCall,
  ServiceCallOptions,
  ServiceCallSettle,
  ServiceCallStatus,
  ServiceDriver,
  ServiceErrorInfo,
  ServiceInvocationDriver,
  ServiceResult,
} from "./types/services";
export type {
  PanoramaDataInfo,
  PanoramaDriver,
  PanoramaHandle,
  PanoramaPov,
  PanoramaServiceHandle,
  PanoramaViewerDriver,
} from "./types/panorama";
export type { MapMouseEvent, EventDriver } from "./types/events";
export type { BMapDriver, BMapEngine, JsapiV4Driver } from "./types/bmap";
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
export {
  normalizeMapMouseEvent,
  normalizeDriverEvent,
  toPoint,
  isPointLike,
  toPlainPoint,
  toPlainPoints,
} from "./normalize";
