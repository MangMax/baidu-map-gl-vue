/**
 * BMapDriver —— 全部 Facet 的聚合接口
 *
 * 组件与业务 composable 只依赖该稳定领域接口，不依赖 BMapGL 全局命名空间。
 *
 * M3A.2 收口（issue #23）：v4 **独有的** Facet 不塞进共享契约——共享契约要同时被
 * webgl-v1 满足，而 v1 没有原生数据图层、也没有归一化服务调用面。它们放在
 * `JsapiV4Driver`（v4 Driver 的返回类型）上，因此默认 cutover（#25）之后组件只要拿到
 * v4 Client 的类型，就能在不碰 raw SDK 的前提下使用这些能力。
 */
import type { CapabilityRegistry } from "../capability/registry";
import type { ControlDriver } from "./controls";
import type { EventDriver } from "./events";
import type { GeometryDriver } from "./geometry";
import type { LayerDriver } from "./layers";
import type { MapDriver } from "./map";
import type { NativeLayerDriver } from "./native-layers";
import type { OverlayDriver } from "./overlays";
import type { PanoramaDriver, PanoramaViewerDriver } from "./panorama";
import type { JsapiV4ServiceDriver, ServiceDriver } from "./services";

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

/**
 * JSAPI 4.0 Driver：共享契约 + v4 独有的三个面。
 *
 * - `services`：在创建面之上多出**归一化调用面**（callback → `ServiceCall<ServiceResult>`）；
 * - `panorama`：从 `{ supported }` 扩展出 viewer / service 的 Handle 与生命周期；
 * - `nativeLayers`：原生批量数据图层（8 种 kind）。
 *
 * 三者都是 `BMapDriver` 对应成员的**子类型**，因此 `JsapiV4Driver` 可以直接用在任何
 * 期望 `BMapDriver` 的位置（`createBMapClient` 的注入点、`createDriver` 的分派）。
 */
export interface JsapiV4Driver extends BMapDriver {
  readonly services: JsapiV4ServiceDriver;
  readonly panorama: PanoramaViewerDriver;
  readonly nativeLayers: NativeLayerDriver;
}
