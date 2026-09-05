/**
 * M2-11: MapContext 类型与 InjectionKey
 *
 * 父子依赖用 typed provide/inject 表达;ready 用状态 + Promise(可回放),
 * 而不是瞬时事件广播(方案 §7.2)。
 */
import type { InjectionKey, ShallowRef } from "vue";
import type { ResourceScope } from "../lifecycle/ResourceScope";
import type { MapEventBus } from "../events/MapEventBus";
import type { FrameScheduler } from "../scheduler/FrameScheduler";

export type MapRuntimeStatus = "idle" | "loading" | "ready" | "error" | "disposing" | "disposed";

export interface MapReadyContext {
  api: unknown;
  map: unknown;
}

export interface MapRuntimeShape {
  readonly id: symbol;
  readonly status: ShallowRef<MapRuntimeStatus>;
  readonly api: ShallowRef<unknown>;
  readonly map: ShallowRef<unknown>;
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
