/**
 * PanoramaDriver
 *
 * 全景能力分两层（M3A2-SERVICES-NATIVE / issue #23）：
 *
 * - **共享面** `PanoramaDriver`：只有 `supported`。webgl-v1 就实现到这里（它没有对应的
 *   Facet 语义，见 ADR「迁移影响」），组件的 `panorama.supported` 判断依赖它；
 * - **v4 面** `PanoramaViewerDriver`：viewer / service 的 Handle skeleton 与生命周期。
 *   本 issue 只交付**底层接口**：数据检索归一到 `ServiceCall`；标签、相册、POI 类型等
 *   声明式能力属 M7（#41，「建立 ControlSpec、常用控件与 Panorama 基线」）。
 */
import type { Point } from "./geometry";
import type { SdkHandle } from "./handles";
import type { ServiceCall } from "./services";

/** 共享面：本引擎是否提供全景能力。 */
export interface PanoramaDriver {
  readonly supported: boolean;
}

/** 全景查看器句柄（`new BMap.Panorama(container, options)`）。 */
export type PanoramaHandle = SdkHandle<"panorama">;
/** 全景数据检索句柄（`new BMap.PanoramaService()`）。 */
export type PanoramaServiceHandle = SdkHandle<"service:panorama">;

/** 全景视角（官方 `PanoramaPov`）：`pitch` 在不改变俯角时可省略。 */
export interface PanoramaPov {
  heading: number;
  pitch?: number;
}

/** 全景数据（官方 `PanoramaData` 的领域投影；`tiles` / `links` 属渲染细节，不透出）。 */
export interface PanoramaDataInfo {
  id: string;
  description: string;
  position: Point | null;
}

/**
 * v4 的全景面：viewer / service 的 Handle skeleton 与生命周期。
 *
 * `extends PanoramaDriver` 是刻意的：`BMapDriver.panorama` 是共享契约，v4 的实现必须
 * 仍然是「一个 `PanoramaDriver`」（`supported` 在这里被实现成**每次读取都重新探测**的
 * getter，见 `jsapi-v4/panorama.ts`），这样 `JsapiV4Driver extends BMapDriver` 成立。
 */
export interface PanoramaViewerDriver extends PanoramaDriver {
  /** 在容器里创建查看器；容器不存在时让 SDK 的错误经 `sdkCall` 归一，不做预检 */
  create(container: string | HTMLElement, options?: Record<string, unknown>): PanoramaHandle;
  /** 销毁查看器（幂等：重复调用不抛错） */
  destroy(viewer: PanoramaHandle): void;

  setPosition(viewer: PanoramaHandle, position: Point): void;
  setPov(viewer: PanoramaHandle, pov: PanoramaPov, options?: { animation?: boolean }): void;
  setZoom(viewer: PanoramaHandle, zoom: number, options?: { noAnimation?: boolean }): void;
  show(viewer: PanoramaHandle): void;
  hide(viewer: PanoramaHandle): void;
  /** 当前是否可见；实例缺该方法时由 SDK 边界归一为错误（不猜） */
  getVisible(viewer: PanoramaHandle): boolean;

  createService(): PanoramaServiceHandle;
  /** 按全景 id 检索（官方 `getPanoramaById`；查不到时回调参数为 `null`） */
  findById(service: PanoramaServiceHandle, id: string): ServiceCall<PanoramaDataInfo>;
  /** 按坐标检索（官方 `getPanoramaByLocation`，半径默认 50 米） */
  findByLocation(
    service: PanoramaServiceHandle,
    position: Point,
    radius?: number,
  ): ServiceCall<PanoramaDataInfo>;
}
