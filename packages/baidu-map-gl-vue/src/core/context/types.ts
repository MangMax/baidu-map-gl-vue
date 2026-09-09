/**
 * MapContext 类型与 InjectionKey
 *
 * 父子依赖用 typed provide/inject 表达;ready 用状态 + Promise(可回放),
 * 而不是瞬时事件广播。
 *
 * MapReadyContext 持有 `client + mapHandle`，
 * 不再暴露 `api/map: unknown`。raw SDK 只从 `./advanced` 提供逃生口。
 */
import type { InjectionKey, ShallowRef } from "vue";
import type { BMapClient } from "../../client/types";
import type { MapHandle } from "../../driver/types/handles";
import type { ResourceScope } from "../lifecycle/ResourceScope";
import type { MapEventBus } from "../events/MapEventBus";
import type { FrameScheduler } from "../scheduler/FrameScheduler";

export type MapRuntimeStatus = "idle" | "loading" | "ready" | "error" | "disposing" | "disposed";

export interface MapReadyContext {
  readonly client: BMapClient;
  readonly map: MapHandle;
}

export interface MapRuntimeShape {
  readonly id: symbol;
  readonly status: ShallowRef<MapRuntimeStatus>;
  readonly client: ShallowRef<BMapClient | null>;
  readonly map: ShallowRef<MapHandle | null>;
  readonly error: ShallowRef<unknown>;
  readonly resources: ResourceScope;
  readonly events: MapEventBus;
  readonly scheduler: FrameScheduler;

  whenReady(signal?: AbortSignal): Promise<MapReadyContext>;
  dispose(): void;
}

/** 供注入使用的 context 接口(带 overlay/plugin registry,后续实现) */
export interface MapContext extends MapRuntimeShape {
  readonly overlays: unknown;
  readonly plugins: unknown;
}

export const mapContextKey: InjectionKey<MapContext> = Symbol("baidu-map-gl-vue:map-context");
export const overlayContextKey: InjectionKey<unknown> = Symbol("baidu-map-gl-vue:overlay-context");
