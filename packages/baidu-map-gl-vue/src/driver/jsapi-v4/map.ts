/**
 * v4 MapDriver（M3A2-MAP / issue #20）
 *
 * 把 JSAPI 4.0 的 `BMap.Map` 收敛成项目领域映射（`MapDriver`），公共 API 零新增。
 *
 * 行为依据（官方 4.0 文档 + `@baidumap/jsapi-v4-types@4.0.4`）：
 * - 构造：`new BMap.Map(idOrElement, options)`，`MapOptions` 支持 `center` / `zoom` /
 *   `heading` / `tilt` / `minZoom` / `maxZoom` / `displayOptions` 与一组 `enable*` 开关；
 * - 视野：`centerAndZoom` 一次设定（v4 **没有** `setView`），后续受控更新走
 *   `setCenter` / `setZoom` 两个独立调用；
 * - 摇摆/倾斜：`setHeading` / `setTilt` 有动画选项；`getHeading()` 返回**带符号**角度
 *   （`setHeading(270)` → `getHeading()` 为 `-90`），因此 heading 不是纯 round-trip 值；
 * - 交互：官方 4.0 API 参考仍公开列出成对 `enable*` / `disable*` 方法（本 facet 使用它们，
 *   原因见 ADR 2026-09-11-jsapi-v4-map-facet「为什么不用 setOptions」）；
 * - 路况：v4 把路况收敛成 `TrafficLayer`，`Map` 自身没有开关 → 交由 Layer Facet（#22），
 *   本 facet 显式 warn + no-op；
 * - 释放：`destroy()` 清空 Map 自身监听器但管不到子对象，因此 Driver 先摘掉自己的订阅分组
 *   与动画引用，再销毁 SDK 对象。
 *
 * 生命周期：`disposed` 是每个 Driver 一份的 WeakSet（键为 raw map），`destroy` 先登记再销毁，
 * 保证「destroy 过程中的重入调用」与「destroy 之后的命令」都被拒绝（`BMAP_RESOURCE_DISPOSED`）。
 */
import { BMapError } from "../../core/errors/BMapError";
import { logger } from "../../core/logger";
import type { CapabilityRegistry } from "../capability/registry";
import type { Bounds, GeometryDriver, Pixel, Point } from "../types/geometry";
import type { MapHandle } from "../types/handles";
import type {
  InitialMapOptions,
  MapDriver,
  MapInteraction,
  MapType,
  MapView,
} from "../types/map";
import type { JsapiV4EventDriver } from "./events";
import {
  assertJsapiV4Namespace,
  callOptional,
  callRequired,
  isObjectLike,
  namespaceCtor,
  readNamespaceMember,
  sdkCall,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

/**
 * 语义交互名 → 官方成对方法名（与 4.0 API 参考逐一对应）。
 *
 * `null` = **4.0 没有该成对方法**：`tilt-gestures` 只有构造选项
 * `MapOptions.enableTiltGestures`，官方 4.0 API 参考的 `BMap.Map` 方法表与
 * `@baidumap/jsapi-v4-types@4.0.4` 的 `core/Map.d.ts` 都没有 `enableTiltGestures()` /
 * `disableTiltGestures()`（对比 `enableRotateGestures()` 是有的）。运行时开关因此不可用 →
 * 显式告警，而不是让 `callOptional` 静默吞掉。
 *
 * 与 `webgl-v1/map.ts` 的同名映射表**刻意保持两份**：跨引擎抽取会让 #26 待删除的实现
 * 阻塞 v4 底座（见 ADR 2026-09-11-jsapi-v4-driver-foundation「负面 / 成本」）。
 */
const INTERACTION_METHODS: Record<
  MapInteraction,
  { enable: string; disable: string } | null
> = {
  dragging: { enable: "enableDragging", disable: "disableDragging" },
  "scroll-zoom": { enable: "enableScrollWheelZoom", disable: "disableScrollWheelZoom" },
  "inertial-dragging": { enable: "enableInertialDragging", disable: "disableInertialDragging" },
  "pinch-zoom": { enable: "enablePinchToZoom", disable: "disablePinchToZoom" },
  keyboard: { enable: "enableKeyboard", disable: "disableKeyboard" },
  "double-click-zoom": { enable: "enableDoubleClickZoom", disable: "disableDoubleClickZoom" },
  "continuous-zoom": { enable: "enableContinuousZoom", disable: "disableContinuousZoom" },
  "resize-on-center": { enable: "enableResizeOnCenter", disable: "disableResizeOnCenter" },
  rotate: { enable: "enableRotate", disable: "disableRotate" },
  "rotate-gestures": { enable: "enableRotateGestures", disable: "disableRotateGestures" },
  tilt: { enable: "enableTilt", disable: "disableTilt" },
  "tilt-gestures": null,
};

/**
 * 语义地图类型 → `BMap.MapTypeId` 静态常量名。
 *
 * 常量从 **SDK 命名空间**读取（`MapTypeId` 的静态成员，官方类型包已声明），不读全局
 * `BMAP_*_MAP`：Driver 边界只认 `rawSdk` 传入的命名空间，避免访问未经 Provider 校验的全局值。
 */
const MAP_TYPE_CONSTANTS: Record<MapType, string> = {
  normal: "BMAP_NORMAL_MAP",
  satellite: "BMAP_SATELLITE_MAP",
  earth: "BMAP_EARTH_MAP",
};

/**
 * 项目 MapOptions 与 v4 `MapOptions` 同名的键（直接映射）。
 *
 * 刻意**不透传**整个项目 options 对象：`InitialMapOptions` 的索引签名允许任意键，整体透传等于
 * 依赖 SDK 静默忽略不认识的键（「依赖隐式默认」）。
 */
const PASSTHROUGH_OPTION_KEYS = ["minZoom", "maxZoom", "displayOptions"] as const;

/**
 * 库固定默认的交互开关（写进构造 options，不依赖 v4 隐式默认）。
 *
 * 只列**库与 v4 默认不一致**或库已声明默认值的项：组件 `<BMap>` 的默认是
 * `enableDragging: true` / `enableScrollWheelZoom: false`，而 v4 的 `enableWheelZoom`
 * 隐式默认是 `true`——不显式固定就会「同一个组件换引擎后行为改变」。其余交互项库没有声明默认值，
 * 沿用 v4 默认（差异清单见 ADR）。
 */
const LIBRARY_MAP_DEFAULTS: Record<string, unknown> = {
  enableDragging: true,
  enableWheelZoom: false,
};

/** 项目已声明但 v4 `MapOptions` 无对应项、且无法无损翻译的键。 */
const UNSUPPORTED_OPTION_KEYS = new Set(["backgroundColor", "restrictCenter"]);

export interface CreateJsapiV4MapDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  geometry: GeometryDriver;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
  /** 同 Client 的 v4 EventDriver：`destroy` 需要它的 target 释放入口。 */
  events: JsapiV4EventDriver;
}

function numberOf(label: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BMapError("BMAP_SDK_CALL_FAILED", `${label} 返回了非数值: ${String(value)}`, {
      engine: "jsapi-v4",
    });
  }
  return value;
}

export function createJsapiV4MapDriver(input: CreateJsapiV4MapDriverInput): MapDriver {
  const { rawSdk, geometry, capabilities, registry, events } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);
  const MapCtor = namespaceCtor(namespace, "Map");
  const mapTypeId = readNamespaceMember(rawSdk, "MapTypeId");

  /** 已销毁的 raw map：destroy 后所有命令按 `BMAP_RESOURCE_DISPOSED` 拒绝。 */
  const disposed = new WeakSet<object>();
  /** raw map → 最近一次启动的视角动画实例（`stopViewAnimation` 没有入参，必须自己记住）。 */
  const animations = new WeakMap<object, unknown>();

  let droppedOptionsWarned = false;
  let trafficWarned = false;
  let tiltGesturesWarned = false;

  /** 句柄 → 存活的 raw map：所有权校验 + 销毁后拒绝命令。 */
  const resolveLive = (map: MapHandle): object => {
    const raw = registry.resolve<object>(map);
    if (disposed.has(raw)) {
      throw new BMapError(
        "BMAP_RESOURCE_DISPOSED",
        "地图已销毁：destroy 之后的命令一律拒绝（避免继续访问已释放的 WebGL/监听器资源）",
        { engine: "jsapi-v4" },
      );
    }
    return raw;
  };

  const toRawCenter = (center: Point | string): unknown =>
    typeof center === "string" ? center : geometry.toRawPoint(center);

  const toV4MapOptions = (options?: InitialMapOptions): Record<string, unknown> => {
    const mapped: Record<string, unknown> = { ...LIBRARY_MAP_DEFAULTS };
    const dropped: string[] = [];
    for (const [key, value] of Object.entries(options ?? {})) {
      if (value === undefined) continue;
      if ((PASSTHROUGH_OPTION_KEYS as readonly string[]).includes(key)) {
        mapped[key] = value;
        continue;
      }
      if (UNSUPPORTED_OPTION_KEYS.has(key)) {
        dropped.push(key);
        continue;
      }
      // 索引签名键：v4 自身构造选项的显式逃生口，按原样透传。
      mapped[key] = value;
    }
    if (dropped.length > 0 && !droppedOptionsWarned) {
      droppedOptionsWarned = true;
      logger.warn(
        `MapDriver: 项目 MapOptions 的 ${dropped.join(" / ")} 在 JSAPI 4.0 无对应构造项，已丢弃` +
          "（范围限制请用 restrictBounds(bounds)，容器背景请用样式）；不透传给 SDK 以免依赖其静默忽略",
      );
    }
    return mapped;
  };

  const resolveMapTypeConstant = (type: MapType): unknown => {
    const constantName = MAP_TYPE_CONSTANTS[type];
    if (!constantName) {
      throw new BMapError("BMAP_INVALID_ARGUMENT", `未知地图类型: ${String(type)}`, {
        engine: "jsapi-v4",
      });
    }
    const value = readNamespaceMember(mapTypeId, constantName);
    if (value == null) {
      throw new BMapError(
        "BMAP_SDK_CALL_FAILED",
        `BMap.MapTypeId.${constantName} is not available`,
        { engine: "jsapi-v4" },
      );
    }
    return value;
  };

  const resolveAnimation = (animation: unknown): unknown => {
    if (registry.owns(animation)) return registry.resolve(animation);
    if (!isObjectLike(animation)) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        `视角动画实例必须是对象或本 Client 的 Handle（收到 ${typeof animation}）`,
        { engine: "jsapi-v4" },
      );
    }
    return animation;
  };

  return {
    create(container, options) {
      const mapOptions = toV4MapOptions(options);
      const raw = sdkCall("Map", () => new MapCtor(container, mapOptions));
      return registry.adopt("map", raw);
    },

    destroy(map) {
      const raw = registry.resolve<object>(map);
      // 幂等：重复 destroy 只释放一次
      if (disposed.has(raw)) return;
      // 先登记「已销毁」再动 SDK 对象：destroy 过程中由事件触发的重入命令会被拒绝
      disposed.add(raw);
      // destroy 前停止业务资源：Driver 侧订阅分组 + 动画引用
      events.release(map);
      animations.delete(raw);
      sdkCall("map.destroy", () => callOptional(raw, "destroy"));
    },

    initializeView(map, view: MapView) {
      const raw = resolveLive(map);
      // 先校验能力再动 SDK 状态：能力守卫在 throw 策略下会抛错，先抛就不会留下
      // 「已 centerAndZoom 但 heading 未应用」的半初始化视野。
      const applyHeading = view.heading != null;
      const applyTilt = view.tilt != null;
      if (applyHeading) capabilities.require("map.heading");
      if (applyTilt) capabilities.require("map.tilt");

      // 初次视野用 centerAndZoom 一次设定（v4 无 setView）；显式 noAnimation，
      // 不依赖 v4 隐式默认，也避免 resetView 时产生动画跳变。
      const options = { noAnimation: true };
      if (typeof view.center === "string") {
        callRequired(raw, "centerAndZoom", view.center, view.zoom, options);
      } else {
        callRequired(raw, "centerAndZoom", geometry.toRawPoint(view.center), view.zoom, options);
      }
      if (applyHeading) callOptional(raw, "setHeading", view.heading, options);
      if (applyTilt) callOptional(raw, "setTilt", view.tilt, options);
    },

    setCenter(map, center) {
      callRequired(resolveLive(map), "setCenter", toRawCenter(center));
    },

    getCenter(map) {
      return geometry.fromRawPoint(callRequired(resolveLive(map), "getCenter"));
    },

    setZoom(map, zoom) {
      callRequired(resolveLive(map), "setZoom", zoom);
    },

    getZoom(map) {
      const raw = resolveLive(map);
      return numberOf("map.getZoom", callRequired(raw, "getZoom"));
    },

    setHeading(map, heading) {
      const raw = resolveLive(map);
      capabilities.require("map.heading");
      callOptional(raw, "setHeading", heading);
    },

    getHeading(map) {
      const raw = resolveLive(map);
      capabilities.require("map.heading");
      return numberOf("map.getHeading", callOptional(raw, "getHeading"));
    },

    setTilt(map, tilt) {
      const raw = resolveLive(map);
      capabilities.require("map.tilt");
      callOptional(raw, "setTilt", tilt);
    },

    getTilt(map) {
      const raw = resolveLive(map);
      capabilities.require("map.tilt");
      return numberOf("map.getTilt", callOptional(raw, "getTilt"));
    },

    getBounds(map) {
      const raw = resolveLive(map);
      return geometry.fromRawBounds(callRequired(raw, "getBounds"));
    },

    getSize(map) {
      const raw = resolveLive(map);
      return geometry.fromRawSize(callRequired(raw, "getSize"));
    },

    pointToPixel(map, point) {
      const raw = resolveLive(map);
      capabilities.require("map.pixel-conversion");
      return geometry.fromRawPixel(
        callRequired(raw, "pointToPixel", geometry.toRawPoint(point)),
      );
    },

    pixelToPoint(map, pixel) {
      const raw = resolveLive(map);
      capabilities.require("map.pixel-conversion");
      return geometry.fromRawPoint(
        callRequired(raw, "pixelToPoint", geometry.toRawPixel(pixel)),
      );
    },

    panTo(map, point) {
      callOptional(resolveLive(map), "panTo", geometry.toRawPoint(point));
    },

    panBy(map, pixel) {
      // v4 `panBy(x, y, options?)` 接收两个数字，不是 Pixel 对象
      callOptional(resolveLive(map), "panBy", pixel.x, pixel.y);
    },

    fitBounds(map, bounds: Bounds) {
      const raw = resolveLive(map);
      capabilities.require("map.viewport");
      // v4 没有 fitBounds：用 setViewport 包含西南 / 东北两个角点（官方语义保证包含传入坐标）
      callOptional(raw, "setViewport", [
        geometry.toRawPoint(bounds.southwest),
        geometry.toRawPoint(bounds.northeast),
      ]);
    },

    setViewport(map, points: readonly Point[], options?: Record<string, unknown>) {
      const raw = resolveLive(map);
      capabilities.require("map.viewport");
      callOptional(raw, "setViewport", points.map((point) => geometry.toRawPoint(point)), options ?? {});
    },

    checkResize(map) {
      callOptional(resolveLive(map), "checkResize");
    },

    setMapType(map, type) {
      callOptional(resolveLive(map), "setMapType", resolveMapTypeConstant(type));
    },

    setMapStyle(map, style) {
      const raw = resolveLive(map);
      capabilities.require("map.style");
      callOptional(raw, "setMapStyle", style as Record<string, unknown>);
    },

    setInteraction(map, name, enabled) {
      const raw = resolveLive(map);
      const methods = INTERACTION_METHODS[name];
      if (methods === null) {
        // v4 没有运行时成对方法（见 INTERACTION_METHODS 注释）：告警一次，不静默吞掉
        if (!tiltGesturesWarned) {
          tiltGesturesWarned = true;
          logger.warn(
            'MapDriver.setInteraction: JSAPI 4.0 没有 enableTiltGestures()/disableTiltGestures()（只有构造选项 MapOptions.enableTiltGestures），' +
              `本次 "${name}" 开关被忽略；需要关闭手势倾斜请在构造 options 中显式传入`,
          );
        }
        return;
      }
      if (!methods) {
        throw new BMapError("BMAP_INVALID_ARGUMENT", `未知交互项: ${String(name)}`, {
          engine: "jsapi-v4",
        });
      }
      callOptional(raw, enabled ? methods.enable : methods.disable);
    },

    setTraffic(map, enabled) {
      resolveLive(map);
      void enabled;
      // v4 把路况收敛为 TrafficLayer（`map.addLayer`），Map 自身没有开关。
      // 这里不做「看起来生效」的静默降级：显式告警一次，由 Layer Facet（#22）承接。
      if (!trafficWarned) {
        trafficWarned = true;
        logger.warn(
          "MapDriver.setTraffic: JSAPI 4.0 的路况是 TrafficLayer，需经 Layer Facet（#22 / M3A2-CONTROLS-LAYERS）接入；" +
            "本次调用被忽略，未对地图产生任何效果",
        );
      }
    },

    startViewAnimation(map, animation) {
      const raw = resolveLive(map);
      capabilities.require("map.animate");
      const instance = resolveAnimation(animation);
      animations.set(raw, instance);
      callOptional(raw, "startViewAnimation", instance);
    },

    stopViewAnimation(map) {
      const raw = resolveLive(map);
      capabilities.require("map.animate");
      // v4 的取消入口是 `cancelViewAnimation(animation)`，必须传同一个实例；
      // 因此 Driver 记住最近一次启动的动画（destroy 时会一并清理）。
      const instance = animations.get(raw);
      if (instance === undefined) return;
      animations.delete(raw);
      callOptional(raw, "cancelViewAnimation", instance);
    },
  };
}
