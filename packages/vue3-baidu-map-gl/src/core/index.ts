export { BMapError } from "./errors/BMapError";
export type { BMapErrorCode, BMapErrorOptions } from "./errors/BMapError";
export { logger, redactAk, setAkForLogger } from "./logger";
export type { Logger } from "./logger";
export { ResourceScope } from "./lifecycle/ResourceScope";
export type { Disposer } from "./lifecycle/ResourceScope";
export { createFrameScheduler } from "./scheduler/FrameScheduler";
export type { FrameScheduler } from "./scheduler/FrameScheduler";
export {
  bindSdkEvent,
  bindSdkEvents,
  extractSdkEventNames,
  normalizeMapEvent,
} from "./events/EventBridge";
export type { BMapSdkEventTarget, NormalizedMapEvent } from "./events/EventBridge";
export { createMapEventBus } from "./events/MapEventBus";
export type { MapEventBus, InternalMapEvents } from "./events/MapEventBus";
export {
  BaiduCdnProvider,
  CustomScriptProvider,
  ExistingGlobalProvider,
  baiduCdnProvider,
  customScriptProvider,
  existingGlobalProvider,
} from "./loader/Provider";
export type { BMapProvider } from "./loader/Provider";
export { ScriptLoader } from "./loader/ScriptLoader";
export type { ScriptLoaderOptions } from "./loader/ScriptLoader";
export { SdkRegistry } from "./loader/SdkRegistry";
export type { SdkRegistryEntry, SdkLoader } from "./loader/SdkRegistry";
export { appendCallback, createBaiduSdkUrl, fingerprintConfig, hash } from "./loader/url";
export type { BMapLoadOptions } from "./loader/url";
export { MapRuntime } from "./runtime/MapRuntime";
export type { MapRuntimeOptions } from "./runtime/MapRuntime";
export { useMapResource } from "./composables/useMapResource";
export type { SdkResourceAdapter, UseMapResourceResult } from "./composables/useMapResource";
export { useControlResource, buildControlOptions } from "./composables/useControlResource";
export type {
  ControlResourceAdapter,
  UseControlResourceResult,
} from "./composables/useControlResource";
export { useLayerResource } from "./composables/useLayerResource";
export type { LayerResourceAdapter, UseLayerResourceResult } from "./composables/useLayerResource";
export type {
  MapContext,
  MapReadyContext,
  MapRuntimeShape,
  MapRuntimeStatus,
} from "./context/types";
export { mapContextKey, overlayContextKey } from "./context/types";
export { useOptionalMapContext, useRequiredMapContext } from "./context/inject";
export { diffData, getItemKey, shouldFullReplace } from "./data/diffData";
export type { DataDiff, ItemKeyFn } from "./data/diffData";
export { gridCluster } from "./data/gridCluster";
export type { Cluster, ClusterOptions, PointLike } from "./data/gridCluster";
export { normalizeIconDescriptor, iconCacheKey, createLruIconCache } from "./icons/iconCache";
export type { IconCache, IconDescriptor } from "./icons/iconCache";
export { createAnimationStateMachine } from "./animation/animationState";
export type {
  AnimationPhase,
  AnimationStateMachine,
  PauseReason,
} from "./animation/animationState";
export { DataLayerManager } from "./data/DataLayerManager";
export type { DataLayerHost, DataLayerOptions } from "./data/DataLayerManager";
export { createOverlayRegistry } from "./overlays/OverlayRegistry";
export type { OverlayRecord, OverlayRegistry } from "./overlays/OverlayRegistry";
export { createPluginRegistry } from "./plugins/PluginRegistry";
export type {
  BMapPluginDefinition,
  PluginRecord,
  PluginRegistry,
  PluginStatus,
} from "./plugins/PluginRegistry";
