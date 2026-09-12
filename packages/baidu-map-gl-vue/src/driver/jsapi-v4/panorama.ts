/**
 * v4 PanoramaDriver（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 交付全景的 **Handle skeleton 与 capability**：查看器（`BMap.Panorama`）的生命周期与视角、
 * 数据检索（`BMap.PanoramaService`）的 callback → `ServiceCall` 归一。标签、相册、POI 类型
 * 这些声明式能力属 M7（#41）。
 *
 * 行为依据（官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.4`）：
 * - `supported` 是**每次读取都重新探测**的 getter，而不是构造期定死的布尔：4.0 的可视化实现
 *   存在异步注入的窗口（issue 风险条目「加载后就绪」），把结论冻结在构造期会让「先建 Driver、
 *   后注入实现」这条正常顺序失败；
 * - `findById` / `findByLocation` 只有一个调用入口，查不到时回调参数是 `null`——因此
 *   「查无数据」是 `empty`，「调用抛错」是 `failed`，两者不混为一谈；
 * - `destroy()` 幂等：Driver 自己记账，重复销毁直接短路（`Panorama#destroy` 的重复调用
 *   在真实运行时没有保证）；
 * - 与 Map / Layer 不同，**Panorama 不挂到 Map 上**（它的容器是独立 DOM），因此本 Facet
 *   没有 `add/remove`，也没有挂在 Map 上的资源需要摘。
 */
import type { Capability } from "../capability/catalog";
import type { CapabilityRegistry } from "../capability/registry";
import { createServiceCall } from "../normalize/serviceCall";
import { toPlainPoint } from "../normalize/results";
import type { GeometryDriver, Point } from "../types/geometry";
import type {
  PanoramaDataInfo,
  PanoramaHandle,
  PanoramaPov,
  PanoramaServiceHandle,
  PanoramaViewerDriver,
} from "../types/panorama";
import {
  assertJsapiV4Namespace,
  callRequired,
  namespaceCtor,
  readNamespaceMember,
  sdkCall,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

export interface CreateJsapiV4PanoramaDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  geometry: GeometryDriver;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
}

/** 全景归一化调用用到的 Catalog 能力（能力清单是单一事实源）。 */
const PANORAMA_CAPABILITIES = {
  viewer: "panorama.viewer",
  service: "panorama.service",
} as const satisfies Record<string, Capability>;

/** 官方 `PanoramaData` → 领域投影（`tiles` / `links` 是渲染细节，不透出）。 */
function toDataInfo(raw: unknown): PanoramaDataInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as {
    id?: unknown;
    description?: unknown;
    position?: { lng: number; lat: number } | null;
  };
  if (typeof data.id !== "string" || data.id.length === 0) return null;
  return {
    id: data.id,
    description: typeof data.description === "string" ? data.description : "",
    position: data.position ? toPlainPoint(data.position) : null,
  };
}

export function createJsapiV4PanoramaDriver(
  input: CreateJsapiV4PanoramaDriverInput,
): PanoramaViewerDriver {
  const { rawSdk, geometry, capabilities, registry } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);

  /** 已销毁的查看器：`destroy()` 幂等（重复销毁短路，不依赖 SDK 的行为）。 */
  const destroyed = new WeakSet<object>();

  const viewerOf = (viewer: PanoramaHandle): Record<string, unknown> =>
    registry.resolve<Record<string, unknown>>(viewer);

  const serviceOf = (service: PanoramaServiceHandle): Record<string, unknown> =>
    registry.resolve<Record<string, unknown>>(service);

  /**
   * 全景数据检索的公共部分：`getPanoramaById` / `getPanoramaByLocation` 都是
   * 「一个 point/id + 一个 callback（`PanoramaData | null`）」。
   */
  const retrieve = (
    raw: Record<string, unknown>,
    method: string,
    label: string,
    args: readonly unknown[],
  ): ReturnType<PanoramaViewerDriver["findById"]> =>
    createServiceCall<PanoramaDataInfo>(
      (settle) => {
        callRequired(raw, method, ...args, (data: unknown) => {
          const info = toDataInfo(data);
          if (!info) {
            // 官方：查不到数据时回调参数为 null（不是错误）
            settle.empty();
            return;
          }
          settle.success(info);
        });
      },
      { label },
    );

  return {
    /**
     * 全景能力是否可用：**每次读取都重新探测**（可视化实现可能异步注入，见文件头）。
     */
    get supported() {
      return typeof readNamespaceMember(namespace, "Panorama") === "function";
    },

    create(container, options = {}) {
      capabilities.require(PANORAMA_CAPABILITIES.viewer);
      const Panorama = namespaceCtor(namespace, "Panorama");
      return registry.adopt("panorama", sdkCall("Panorama", () => new Panorama(container, options)));
    },

    destroy(viewer) {
      const raw = viewerOf(viewer);
      if (destroyed.has(raw)) return;
      // 口径与 Control / Layer Facet 一致：**先 `claim` 再调 SDK，失败时 `release`**。
      // 先 claim 挡的是重入（业务在 SDK 的销毁回调里再次 destroy）；失败时 release 保证
      // 「销毁失败」不会被记账伪装成「已销毁」——真实 4.0 在**未加载场景**的实例上
      // `destroy()` 会抛 `TypeError`（见 ADR 的 smoke 记录），那时必须能重试。
      destroyed.add(raw);
      try {
        sdkCall("Panorama.destroy", () => callRequired(raw, "destroy"));
      } catch (error) {
        destroyed.delete(raw);
        throw error;
      }
    },

    setPosition(viewer, position: Point) {
      callRequired(viewerOf(viewer), "setPosition", geometry.toRawPoint(position));
    },

    setPov(viewer, pov: PanoramaPov, options) {
      // 官方：可以只设 heading；显式给 pitch 时必须同时给 heading（调用方负责语义）
      const payload =
        typeof pov.pitch === "number"
          ? { heading: pov.heading, pitch: pov.pitch }
          : { heading: pov.heading };
      if (options) callRequired(viewerOf(viewer), "setPov", payload, options);
      else callRequired(viewerOf(viewer), "setPov", payload);
    },

    setZoom(viewer, zoom: number, options) {
      if (options) callRequired(viewerOf(viewer), "setZoom", zoom, options);
      else callRequired(viewerOf(viewer), "setZoom", zoom);
    },

    show(viewer) {
      callRequired(viewerOf(viewer), "show");
    },

    hide(viewer) {
      callRequired(viewerOf(viewer), "hide");
    },

    getVisible(viewer) {
      return Boolean(callRequired(viewerOf(viewer), "getVisible"));
    },

    createService() {
      capabilities.require(PANORAMA_CAPABILITIES.service);
      const PanoramaService = namespaceCtor(namespace, "PanoramaService");
      return registry.adopt(
        "service:panorama",
        sdkCall("PanoramaService", () => new PanoramaService()),
      );
    },

    findById(service, id: string) {
      return retrieve(serviceOf(service), "getPanoramaById", "PanoramaService.getPanoramaById", [
        id,
      ]);
    },

    findByLocation(service, position: Point, radius?: number) {
      const raw = serviceOf(service);
      // 官方的重载是 (point, cb) 与 (point, radius, cb)——半径不是可选参数占位，
      // 因此不给半径时必须省略它，而不是传 undefined。
      if (typeof radius === "number") {
        return retrieve(raw, "getPanoramaByLocation", "PanoramaService.getPanoramaByLocation", [
          geometry.toRawPoint(position),
          radius,
        ]);
      }
      return retrieve(raw, "getPanoramaByLocation", "PanoramaService.getPanoramaByLocation", [
        geometry.toRawPoint(position),
      ]);
    },
  };
}
