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
import { BMapError } from "../../core/errors/BMapError";
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
import type { JsapiV4EventDriver } from "./events";
import type { JsapiV4HandleRegistry } from "./registry";

export interface CreateJsapiV4PanoramaDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  geometry: GeometryDriver;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
  /** 同 Client 的 v4 EventDriver：`destroy` 需要它的 target 释放入口。 */
  events: JsapiV4EventDriver;
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
  const { rawSdk, geometry, capabilities, registry, events } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);

  /**
   * 销毁的三个状态**分开记账**（PR #63 复审 P2-2 之后）。
   *
   * 一个 `destroyed` 布尔同时表达「不要再做任何事」和「已经清干净了」会同时踩两个坑：
   * - 把它当重入保护用，就得在调 SDK **之前**写 —— 于是销毁失败也被记成「已销毁」，重试入口消失；
   * - 把它当完成标记用，就得在调 SDK **之后**写 —— 于是 teardown 期间的重入会真的销毁两次。
   *
   * 因此拆成：`disposing`（在飞，重入短路）/ `released`（Driver 侧订阅已释放）/
   * `destroyed`（SDK 对象已销毁）。重试只补做**尚未完成**的那一步，绝不会重复销毁同一个底层对象。
   */
  const disposing = new WeakSet<object>();
  const released = new WeakSet<object>();
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
      // 已完成 / 正在清理：直接短路（重入保护，避免同一个底层对象被销毁两次）
      if (destroyed.has(raw) || disposing.has(raw)) return;
      disposing.add(raw);

      const failures: unknown[] = [];
      try {
        // 顺序与 Map Facet 一致：**先解绑 Driver 侧的业务事件，再销毁 SDK 对象**。
        // EventDriver 的 groups 是强引用（Map<rawTarget, …>），不主动 release 就会长期持有
        // 已销毁的 raw 对象与业务回调；解绑失败**不阻断** SDK 销毁（`events.release` 的契约
        // 是「其余项已尽力释放」），但两者都要汇总抛出，由调用方决定是否重试。
        if (!released.has(raw)) {
          events.release(viewer);
          released.add(raw);
        }
      } catch (error) {
        failures.push(error);
      }
      try {
        sdkCall("Panorama.destroy", () => callRequired(raw, "destroy"));
        destroyed.add(raw);
      } catch (error) {
        failures.push(error);
      } finally {
        disposing.delete(raw);
      }

      if (failures.length > 0) {
        const details = failures
          .map((failure) => (failure as Error)?.message ?? String(failure))
          .join("; ");
        throw new BMapError(
          "BMAP_SDK_CALL_FAILED",
          `全景销毁时有 ${failures.length} 项未完成（其余步骤已尽力执行；` +
            `再次 destroy 只会补做未完成的那一步）: ${details}`,
          { cause: failures[0], engine: "jsapi-v4" },
        );
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
