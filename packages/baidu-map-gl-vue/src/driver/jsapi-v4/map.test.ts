/**
 * v4 MapDriver（M3A2-MAP / issue #20）
 *
 * 验收点（对应 issue #20 的「测试要求」）：
 * - 创建 / 销毁与**零尺寸容器**行为；
 * - center / zoom / heading / tilt round-trip；
 * - 投影转换与 bounds / size；
 * - 交互开关对全部语义项生效且幂等；
 * - destroy 释放业务资源，destroy 之后的命令按 `BMAP_RESOURCE_DISPOSED` 拒绝；
 * - 项目 MapOptions → v4 构造 options 的显式映射（不依赖 SDK 隐式默认）。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeV4Map, createFakeBMapV4, type FakeBMapV4 } from "../../../../test-utils";
import { MAP_INTERACTIONS } from "../../../../test-utils/driver-contract";
import { createCapabilityRegistry } from "../capability/registry";
import type { MapDriver, MapInteraction } from "../types/map";
import { createJsapiV4EventDriver } from "./events";
import { createJsapiV4GeometryDriver } from "./geometry";
import { createJsapiV4MapDriver } from "./map";
import { createJsapiV4HandleRegistry } from "./registry";

/**
 * 交互名 → Fake 侧（官方方法名派生的）状态键。
 *
 * 刻意**独立于实现**手写一份：这是「语义名 → 官方方法名」的期望值，不能从被测实现里导出，
 * 否则测试只是在复述实现。
 */
const INTERACTION_STATE_KEYS: Record<MapInteraction, string> = {
  dragging: "dragging",
  "scroll-zoom": "scrollWheelZoom",
  "inertial-dragging": "inertialDragging",
  "pinch-zoom": "pinchToZoom",
  keyboard: "keyboard",
  "double-click-zoom": "doubleClickZoom",
  "continuous-zoom": "continuousZoom",
  "resize-on-center": "resizeOnCenter",
  rotate: "rotate",
  "rotate-gestures": "rotateGestures",
  tilt: "tilt",
  "tilt-gestures": "tiltGestures",
};

/**
 * v4 没有成对方法的交互项：`tilt-gestures` 只有构造选项 `MapOptions.enableTiltGestures`
 * （官方 4.0 API 参考与 4.0.4 类型包都没有 `enableTiltGestures()` 方法），因此运行时开关
 * 必须是「告警 + 不生效」，而不是静默 no-op。
 */
const INTERACTIONS_WITHOUT_V4_METHODS: MapInteraction[] = ["tilt-gestures"];

function setup(overrides: { width?: string; height?: string; unsupported?: "throw" | "warn" | "silent" } = {}) {
  const fake: FakeBMapV4 = createFakeBMapV4();
  const registry = createJsapiV4HandleRegistry();
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  const events = createJsapiV4EventDriver({ registry, geometry });
  const capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported: overrides.unsupported ?? "throw",
  });
  const map: MapDriver = createJsapiV4MapDriver({
    rawSdk: fake.namespace,
    geometry,
    capabilities,
    registry,
    events,
  });
  const container = document.createElement("div");
  container.style.width = overrides.width ?? "640px";
  container.style.height = overrides.height ?? "480px";
  document.body.appendChild(container);
  return { fake, registry, geometry, events, capabilities, map, container };
}

let ctx: ReturnType<typeof setup>;

beforeEach(() => {
  ctx = setup();
});

describe("创建与销毁", () => {
  it("用 HTMLElement 容器创建，映射项目 MapOptions 为 v4 构造 options", () => {
    const { map, container, fake } = setup({
      width: "320px",
      height: "200px",
    });
    const handle = map.create(container, {
      minZoom: 5,
      maxZoom: 18,
      displayOptions: { poi: false },
    });

    expect(handle.raw).toBe(fake.createdMaps[0]);
    // 同名的项目键直接映射
    expect(fake.createdMaps[0].options).toMatchObject({
      minZoom: 5,
      maxZoom: 18,
      displayOptions: { poi: false },
    });
    // 库固定默认写进构造 options，不依赖 v4 的隐式默认
    expect(fake.createdMaps[0].options.enableDragging).toBe(true);
    expect(fake.createdMaps[0].options.enableWheelZoom).toBe(false);
  });

  it("v4 无对应项的项目键被丢弃（不透传，靠 warn 可观测）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, container, fake } = setup();
    map.create(container, { restrictCenter: true, backgroundColor: [0, 0, 0, 0] });

    expect(fake.createdMaps[0].options).not.toHaveProperty("restrictCenter");
    expect(fake.createdMaps[0].options).not.toHaveProperty("backgroundColor");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("零尺寸容器可以创建、读取尺寸，容器变大后 checkResize 得到新尺寸", () => {
    const { map, container, fake } = setup({ width: "0px", height: "0px" });
    const handle = map.create(container);
    expect(map.getSize(handle)).toEqual({ width: 0, height: 0 });

    container.style.width = "400px";
    container.style.height = "300px";
    map.checkResize(handle);
    expect(map.getSize(handle)).toEqual({ width: 400, height: 300 });
    expect(fake.createdMaps[0].resizeCalls).toBe(1);

    map.destroy(handle);
    expect(fake.createdMaps[0].destroyed).toBe(true);
  });

  it("destroy 幂等，并释放 EventDriver 在该地图上的订阅分组", () => {
    const { map, container, events, fake } = setup();
    const handle = map.create(container);
    events.on(handle, "click", () => {});
    expect(fake.stats.liveListeners).toBe(1);

    map.destroy(handle);
    map.destroy(handle);

    expect(fake.createdMaps[0].destroyed).toBe(true);
    expect(fake.stats.liveListeners).toBe(0);
    expect(fake.createdMaps[0].callLog.filter((call) => call === "destroy")).toHaveLength(1);
  });

  it("destroy 之后的**每一个**命令都按 BMAP_RESOURCE_DISPOSED 拒绝", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    map.destroy(handle);

    // 覆盖 MapDriver 的全部成员：任何漏加守卫的成员都会在这里暴露
    const commands: Array<[string, () => unknown]> = [
      ["initializeView", () => map.initializeView(handle, { center: { lng: 1, lat: 1 }, zoom: 1 })],
      ["setCenter", () => map.setCenter(handle, { lng: 116.5, lat: 39.9 })],
      ["getCenter", () => map.getCenter(handle)],
      ["setZoom", () => map.setZoom(handle, 12)],
      ["getZoom", () => map.getZoom(handle)],
      ["setHeading", () => map.setHeading(handle, 30)],
      ["getHeading", () => map.getHeading(handle)],
      ["setTilt", () => map.setTilt(handle, 30)],
      ["getTilt", () => map.getTilt(handle)],
      ["getBounds", () => map.getBounds(handle)],
      ["getSize", () => map.getSize(handle)],
      ["pointToPixel", () => map.pointToPixel(handle, { lng: 116.4, lat: 39.9 })],
      ["pixelToPoint", () => map.pixelToPoint(handle, { x: 10, y: 20 })],
      ["panTo", () => map.panTo(handle, { lng: 116.4, lat: 39.9 })],
      ["panBy", () => map.panBy(handle, { x: 10, y: 20 })],
      ["fitBounds", () =>
        map.fitBounds(handle, {
          southwest: { lng: 116.2, lat: 39.7 },
          northeast: { lng: 116.6, lat: 40.1 },
        })],
      ["setViewport", () => map.setViewport(handle, [{ lng: 116.4, lat: 39.9 }])],
      ["checkResize", () => map.checkResize(handle)],
      ["setMapType", () => map.setMapType(handle, "normal")],
      ["setMapStyle", () => map.setMapStyle(handle, { styleId: "s" })],
      ["setInteraction", () => map.setInteraction(handle, "dragging", true)],
      ["setTraffic", () => map.setTraffic(handle, true)],
      ["startViewAnimation", () => map.startViewAnimation(handle, { frames: [] })],
      ["stopViewAnimation", () => map.stopViewAnimation(handle)],
      ["destroy（幂等，不抛）", () => map.destroy(handle)],
    ];

    for (const [name, command] of commands) {
      if (name.startsWith("destroy")) {
        expect(command, name).not.toThrow();
        continue;
      }
      expect(command, name).toThrowError(
        expect.objectContaining({ code: "BMAP_RESOURCE_DISPOSED" }),
      );
    }
  });

  it("跨 Client 的句柄被拒绝（所有权在 Map facet 同样生效）", () => {
    const { map } = setup();
    const other = setup();
    const foreign = other.map.create(other.container);
    expect(() => map.getZoom(foreign)).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});

describe("视野 round-trip", () => {
  it("initializeView 用 centerAndZoom 一次设定中心与级别（显式 noAnimation）", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.404, lat: 39.915 }, zoom: 14 });

    expect(fake.createdMaps[0].callLog).toContain("centerAndZoom");
    expect(map.getZoom(handle)).toBe(14);
    expect(map.getCenter(handle)).toEqual({ lng: 116.404, lat: 39.915 });
    // 初次视野不依赖 SDK 隐式默认（v4 的 centerAndZoom 默认 noAnimation: true）
    expect(fake.createdMaps[0].lastViewOptions).toEqual({ noAnimation: true });
  });

  it("initializeView 支持城市名（v4 的 string 重载）", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.initializeView(handle, { center: "北京", zoom: 11 });
    expect(fake.createdMaps[0].callLog).toContain("centerAndZoom");
    expect(map.getZoom(handle)).toBe(11);
  });

  it("后续更新只用 setCenter / setZoom，不重置另一维", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.4, lat: 39.9 }, zoom: 14 });

    fake.createdMaps[0].callLog.length = 0;
    map.setCenter(handle, { lng: 121.5, lat: 31.2 });
    expect(fake.createdMaps[0].callLog).toEqual(["setCenter"]);
    expect(map.getZoom(handle)).toBe(14);

    fake.createdMaps[0].callLog.length = 0;
    map.setZoom(handle, 9);
    expect(fake.createdMaps[0].callLog).toEqual(["setZoom"]);
    expect(map.getCenter(handle)).toEqual({ lng: 121.5, lat: 31.2 });
  });

  it("heading / tilt round-trip", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });

    map.setHeading(handle, 45);
    expect(map.getHeading(handle)).toBe(45);
    map.setTilt(handle, 30);
    expect(map.getTilt(handle)).toBe(30);
  });

  it("initializeView 的 heading / tilt 走同一条 setHeading / setTilt 路径", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.initializeView(handle, {
      center: { lng: 116.4, lat: 39.9 },
      zoom: 12,
      heading: 90,
      tilt: 45,
    });
    expect(fake.createdMaps[0].callLog).toContain("setHeading");
    expect(fake.createdMaps[0].callLog).toContain("setTilt");
    expect(map.getHeading(handle)).toBe(90);
    expect(map.getTilt(handle)).toBe(45);
  });

  it("panTo / panBy / setViewport / fitBounds 抵达 SDK", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });
    fake.createdMaps[0].callLog.length = 0;

    map.panTo(handle, { lng: 116.5, lat: 39.9 });
    // v4 的 panBy 接收 (x, y) 两个数字，不是 Pixel 对象
    map.panBy(handle, { x: 100, y: -50 });
    map.setViewport(handle, [
      { lng: 116.3, lat: 39.8 },
      { lng: 116.5, lat: 40.0 },
    ]);
    map.fitBounds(handle, {
      southwest: { lng: 116.2, lat: 39.7 },
      northeast: { lng: 116.6, lat: 40.1 },
    });

    expect(fake.createdMaps[0].callLog).toContain("panTo");
    expect(fake.createdMaps[0].callLog).toContain("panBy:100,-50");
    expect(fake.createdMaps[0].callLog.filter((call) => call === "setViewport")).toHaveLength(2);
  });

  it("getBounds / getSize 返回归一化后的纯数据", () => {
    const { map, container } = setup({ width: "320px", height: "240px" });
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });

    const bounds = map.getBounds(handle);
    expect(bounds.southwest.lng).toBeLessThan(bounds.northeast.lng);
    expect(bounds.southwest.lat).toBeLessThan(bounds.northeast.lat);
    expect(map.getSize(handle)).toEqual({ width: 320, height: 240 });
  });

  it("未初始化视野时 getBounds 报结构化错误而不是 0/0", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    expect(() => map.getBounds(handle)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("投影转换 round-trip，且视口中心落在容器中心", () => {
    const { map, container } = setup({ width: "640px", height: "480px" });
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.404, lat: 39.915 }, zoom: 14 });

    const point = { lng: 116.414, lat: 39.905 };
    const pixel = map.pointToPixel(handle, point);
    const roundTrip = map.pixelToPoint(handle, pixel);
    expect(roundTrip.lng).toBeCloseTo(point.lng, 10);
    expect(roundTrip.lat).toBeCloseTo(point.lat, 10);
    expect(map.pointToPixel(handle, { lng: 116.404, lat: 39.915 })).toEqual({
      x: 320,
      y: 240,
    });
  });
});

describe("交互开关", () => {
  it("除 tilt-gestures 外，全部语义交互项都映射到官方成对方法并生效", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);

    for (const interaction of MAP_INTERACTIONS) {
      if (INTERACTIONS_WITHOUT_V4_METHODS.includes(interaction)) continue;
      map.setInteraction(handle, interaction, false);
      expect(fake.createdMaps[0].interactions[INTERACTION_STATE_KEYS[interaction]]).toBe(false);
      map.setInteraction(handle, interaction, true);
      expect(fake.createdMaps[0].interactions[INTERACTION_STATE_KEYS[interaction]]).toBe(true);
    }
  });

  it("tilt-gestures 在 v4 没有成对方法：告警一次且不产生 SDK 调用", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, container, fake } = setup();
    const handle = map.create(container);
    fake.createdMaps[0].callLog.length = 0;

    map.setInteraction(handle, "tilt-gestures", false);
    map.setInteraction(handle, "tilt-gestures", true);

    expect(fake.createdMaps[0].interactions.tiltGestures).toBeUndefined();
    expect(fake.createdMaps[0].callLog).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("交互开关幂等：重复设置同一状态不产生额外副作用", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);

    map.setInteraction(handle, "scroll-zoom", false);
    map.setInteraction(handle, "scroll-zoom", false);

    expect(fake.createdMaps[0].interactions.scrollWheelZoom).toBe(false);
    // 每次调用都落在官方方法上，但状态稳定（幂等 = 结果不随重复调用漂移）
    expect(
      fake.createdMaps[0].callLog.filter((call) => call === "disableScrollWheelZoom"),
    ).toHaveLength(2);
  });

  it("未知交互项按非法参数拒绝", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    expect(() => map.setInteraction(handle, "unknown" as MapInteraction, true)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });
});

describe("底图类型与样式", () => {
  it("语义地图类型映射到 MapTypeId 常量", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.setMapType(handle, "normal");
    map.setMapType(handle, "satellite");
    map.setMapType(handle, "earth");

    expect(fake.createdMaps[0].mapType).toBe("BMAP_EARTH_MAP");
    expect(fake.createdMaps[0].callLog).toContain("setMapType:BMAP_NORMAL_MAP");
    expect(fake.createdMaps[0].callLog).toContain("setMapType:BMAP_SATELLITE_MAP");
  });

  it("未知地图类型按非法参数拒绝", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    expect(() => map.setMapType(handle, "planet" as never)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("mapTypeId 缺失时报 SDK 边界错误", () => {
    const fake = createFakeBMapV4();
    const { MapTypeId, ...withoutMapTypeId } = fake.namespace;
    void MapTypeId;
    const registry = createJsapiV4HandleRegistry();
    const geometry = createJsapiV4GeometryDriver(withoutMapTypeId);
    const events = createJsapiV4EventDriver({ registry, geometry });
    const capabilities = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: withoutMapTypeId,
      unsupported: "silent",
    });
    const map = createJsapiV4MapDriver({
      rawSdk: withoutMapTypeId,
      geometry,
      capabilities,
      registry,
      events,
    });
    const handle = map.create(ctx.container);
    expect(() => map.setMapType(handle, "normal")).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
  });

  it("setMapStyle 透传给 v4 setMapStyle", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.setMapStyle(handle, { styleId: "style-1" });
    expect(fake.createdMaps[0].mapStyle).toEqual({ styleId: "style-1" });
  });

  it("setTraffic 在 v4 显式告警并忽略（路况属 Layer Facet #22）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, container, fake } = setup();
    const handle = map.create(container);
    map.setTraffic(handle, true);
    expect(warn).toHaveBeenCalled();
    expect(fake.createdMaps[0].callLog.some((call) => call.startsWith("setTraffic"))).toBe(false);
    warn.mockRestore();
  });
});

describe("能力守卫", () => {
  it("heading / tilt / animate / viewport 由能力注册表把关", () => {
    const { capabilities } = setup();
    for (const capability of [
      "map.heading",
      "map.tilt",
      "map.animate",
      "map.viewport",
      "map.pixel-conversion",
      "map.style",
    ] as const) {
      expect(capabilities.supports(capability)).toBe(true);
    }
  });

  it("能力缺失且策略为 throw 时 setHeading 抛 BMAP_CAPABILITY_UNSUPPORTED", () => {
    const fake = createFakeBMapV4();
    // 抹掉 Map 原型上的旋转能力，模拟「加载成功但该能力不可用」的 SDK 边界。
    // 方法定义在 FakeV4Map 上（`namespace.Map` 只是子类），因此必须动基类原型。
    const prototype = FakeV4Map.prototype as unknown as Record<string, unknown>;
    const originalSetHeading = prototype.setHeading;
    const originalGetHeading = prototype.getHeading;
    delete prototype.setHeading;
    delete prototype.getHeading;

    try {
      const registry = createJsapiV4HandleRegistry();
      const geometry = createJsapiV4GeometryDriver(fake.namespace);
      const events = createJsapiV4EventDriver({ registry, geometry });
      const capabilities = createCapabilityRegistry({
        engine: "jsapi-v4",
        version: "4.0",
        rawSdk: fake.namespace,
        unsupported: "throw",
      });
      const map = createJsapiV4MapDriver({
        rawSdk: fake.namespace,
        geometry,
        capabilities,
        registry,
        events,
      });
      const handle = map.create(ctx.container);
      expect(map.initializeView(handle, { center: { lng: 0, lat: 0 }, zoom: 10 })).toBeUndefined();
      expect(capabilities.supports("map.heading")).toBe(false);
      expect(() => map.setHeading(handle, 30)).toThrowError(
        expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
      );
    } finally {
      prototype.setHeading = originalSetHeading;
      prototype.getHeading = originalGetHeading;
    }
  });
});

describe("视角动画", () => {
  it("startViewAnimation 记住实例，stopViewAnimation 用同一实例 cancel", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const animation = { frames: [] };

    map.startViewAnimation(handle, animation);
    expect(fake.createdMaps[0].lastAnimation).toBe(animation);

    map.stopViewAnimation(handle);
    expect(fake.createdMaps[0].canceledAnimation).toBe(animation);
  });

  it("stopViewAnimation 在没有活动动画时是 no-op，未销毁地图仍可用", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    map.initializeView(handle, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });
    expect(() => map.stopViewAnimation(handle)).not.toThrow();
    expect(map.getZoom(handle)).toBe(12);
  });

  it("destroy 会清掉动画引用（不再持有已销毁地图的动画实例）", () => {
    const { map, container, fake } = setup();
    const handle = map.create(container);
    const animation = { frames: [] };
    map.startViewAnimation(handle, animation);
    map.destroy(handle);
    // 动画引用随 destroy 清理：再次 stop 会被 BMAP_RESOURCE_DISPOSED 拒绝
    expect(() => map.stopViewAnimation(handle)).toThrowError(
      expect.objectContaining({ code: "BMAP_RESOURCE_DISPOSED" }),
    );
    expect(fake.createdMaps[0].callLog.filter((call) => call === "cancelViewAnimation")).toHaveLength(0);
  });

  it("非对象动画入参按非法参数拒绝", () => {
    const { map, container } = setup();
    const handle = map.create(container);
    expect(() => map.startViewAnimation(handle, 42)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });
});
