/**
 * BMapDriver —— 全部 Facet 的聚合接口
 *
 * 组件与业务 composable 只依赖该稳定领域接口，不依赖 BMapGL 全局命名空间。
 */
import type { CapabilityRegistry } from "../capability/registry";
import type { ControlDriver } from "./controls";
import type { EventDriver } from "./events";
import type { GeometryDriver } from "./geometry";
import type { LayerDriver } from "./layers";
import type { MapDriver } from "./map";
import type { OverlayDriver } from "./overlays";
import type { PanoramaDriver } from "./panorama";
import type { ServiceDriver } from "./services";

export type BMapEngine = "webgl-v1" | "jsapi-v3" | "jsapi-v4";

export interface BMapDriver {
  readonly engine: BMapEngine;
  readonly version: string;
  readonly rawSdk: unknown;
  readonly capabilities: CapabilityRegistry;

  readonly geometry: GeometryDriver;
  readonly map: MapDriver;
  readonly overlays: OverlayDriver;
  readonly controls: ControlDriver;
  readonly layers: LayerDriver;
  readonly services: ServiceDriver;
  readonly panorama: PanoramaDriver;
  readonly events: EventDriver;
}
