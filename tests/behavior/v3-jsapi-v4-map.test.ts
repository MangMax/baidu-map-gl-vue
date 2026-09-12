/**
 * v4 Map facet 行为验证（M3A2-MAP / issue #20）
 *
 * 这一层验证两件事：
 * 1. **同一个 Map facet 契约**在两个 Fake 上都能通过 —— 本文件让 v4 Map facet 直接跑
 *    `runMapFacetContract`，与 `tests/behavior/v3-driver-contract.test.ts` 的 webgl-v1
 *    harness 共用同一套断言（契约的单一事实源在 `packages/test-utils/driver-contract.ts`）；
 * 2. v4 特有的生命周期策略 —— destroy 释放 Fake diagnostics 里的地图资源、destroy 之后的
 *    命令按 `BMAP_RESOURCE_DISPOSED` 拒绝（webgl-v1 是待删除实现，不追平该策略）。
 *
 * 组装方式：v4 的 Facet 装配（`createJsapiV4Driver`）属 #23/#25，本 issue 只在测试里
 * 手工组合 Map facet 与它的依赖，不提前改动默认 Client 路径。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../packages/test-utils";
import {
  runMapFacetContract,
  type MapFacetDriver,
  type MapFacetHarness,
} from "../../packages/test-utils/driver-contract";
import { createCapabilityRegistry } from "../../packages/baidu-map-gl-vue/src/driver/capability/registry";
import { createJsapiV4EventDriver } from "../../packages/baidu-map-gl-vue/src/driver/jsapi-v4/events";
import { createJsapiV4GeometryDriver } from "../../packages/baidu-map-gl-vue/src/driver/jsapi-v4/geometry";
import { createJsapiV4MapDriver } from "../../packages/baidu-map-gl-vue/src/driver/jsapi-v4/map";
import { createJsapiV4HandleRegistry } from "../../packages/baidu-map-gl-vue/src/driver/jsapi-v4/registry";

let fake: FakeBMapV4;
let driver: MapFacetDriver;
let registry: ReturnType<typeof createJsapiV4HandleRegistry>;

function sizedContainer(width = 300, height = 300): HTMLElement {
  const el = document.createElement("div");
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  fake = createFakeBMapV4();
  registry = createJsapiV4HandleRegistry();
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  const events = createJsapiV4EventDriver({ registry, geometry });
  const capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported: "throw",
  });
  driver = {
    map: createJsapiV4MapDriver({
      rawSdk: fake.namespace,
      geometry,
      capabilities,
      registry,
      events,
    }),
    geometry,
    events,
    capabilities,
  };
});

function createHarness(): MapFacetHarness {
  return { driver: () => driver, container: () => sizedContainer() };
}

runMapFacetContract(createHarness);

describe("v4 Map facet 生命周期", () => {
  it("destroy 释放该地图上的资源，且不牵连其它 target 的订阅", () => {
    const map = driver.map.create(sizedContainer());
    const marker = registry.adopt(
      "overlay:marker",
      new fake.namespace.Marker(new fake.namespace.Point(116.4, 39.9)),
    );
    const disposeMarker = driver.events.on(marker, "click", () => {});
    driver.events.on(map, "moveend", () => {});
    driver.events.on(map, "click", () => {});
    expect(fake.stats.liveListeners).toBe(3);

    driver.map.destroy(map);

    // 地图自己的两条订阅随 destroy 释放；Marker 上的订阅仍归调用方管（不强杀子对象）
    expect(fake.stats.liveListeners).toBe(1);
    expect(fake.createdMaps[0].getListenerCount()).toBe(0);
    expect(fake.createdMaps[0].destroyed).toBe(true);

    disposeMarker();
    expect(fake.stats.liveListeners).toBe(0);
  });

  it("destroy 之后的命令按 BMAP_RESOURCE_DISPOSED 拒绝，且不再触碰 SDK 对象", () => {
    const map = driver.map.create(sizedContainer());
    driver.map.initializeView(map, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });
    driver.map.destroy(map);
    const callsAfterDestroy = fake.createdMaps[0].callLog.length;

    expect(() => driver.map.getZoom(map)).toThrowError(
      expect.objectContaining({ code: "BMAP_RESOURCE_DISPOSED" }),
    );
    expect(() => driver.map.setCenter(map, { lng: 1, lat: 1 })).toThrowError(
      expect.objectContaining({ code: "BMAP_RESOURCE_DISPOSED" }),
    );
    expect(fake.createdMaps[0].callLog.length).toBe(callsAfterDestroy);
  });

  it("事件订阅经由 Driver 归一化后派发（point/pixel + raw 逃生口）", () => {
    const map = driver.map.create(sizedContainer());
    const received: unknown[] = [];
    driver.events.on(map, "click", (event) => received.push(event));

    fake.createdMaps[0].emit("click", {
      point: { lng: 116.404, lat: 39.915 },
      pixel: { x: 10, y: 20 },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "click",
      point: { lng: 116.404, lat: 39.915 },
      pixel: { x: 10, y: 20 },
    });
  });

  it("Map Handle 稳定：同一个 raw map 复用同一个 Handle", () => {
    const map = driver.map.create(sizedContainer());
    expect(registry.lookup(map.raw)).toBe(map);
    expect(registry.resolve(map)).toBe(map.raw);
  });
});

/**
 * `setMapType` 的常量落点（M3A3-CUTOVER / #25 的真实 smoke 回归）
 *
 * 修前只读 `BMap.MapTypeId.<BMAP_*_MAP>`，而**真实** 4.0 运行时的 `MapTypeId` 是
 * `{ NORMAL, EARTH, SATELLITE }`（实测 2026-09-12），于是取值为 `undefined` →
 * `<BMap>` 在 `applyMapType` 抛错、永远到不了 ready。Fake v4 因为镜像了官方**类型声明**
 * 的 `BMAP_*` 静态成员，恰好掩盖了这条差异——所以这里刻意用「真实形状」的命名空间来测。
 */
describe("v4 Map setMapType 的常量落点", () => {
  /**
   * 真实 4.0 形状：命名空间上有 `BMAP_*_MAP`；`MapTypeId` 只有短键，且
   * `SATELLITE` 的取值是 `B_STREET_MAP`（= `BMAP_HYBRID_MAP`，**不是**卫星图的 token）。
   */
  function realShapeNamespace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...(fake.namespace as unknown as Record<string, unknown>),
      BMAP_NORMAL_MAP: "B_NORMAL_MAP",
      BMAP_SATELLITE_MAP: "B_SATELLITE_MAP",
      BMAP_EARTH_MAP: "B_EARTH_MAP",
      MapTypeId: { NORMAL: "B_NORMAL_MAP", EARTH: "B_EARTH_MAP", SATELLITE: "B_STREET_MAP" },
      ...overrides,
    };
  }

  function driverFor(namespace: Record<string, unknown>): ReturnType<typeof createJsapiV4MapDriver> {
    const geometry = createJsapiV4GeometryDriver(namespace);
    const events = createJsapiV4EventDriver({ registry, geometry });
    const capabilities = createCapabilityRegistry({
      engine: "jsapi-v4",
      version: "4.0",
      rawSdk: namespace,
      // 这一组用例只关心常量解析，不引入能力策略的干扰
      unsupported: "warn",
    });
    return createJsapiV4MapDriver({ rawSdk: namespace, geometry, capabilities, registry, events });
  }

  it("优先用命名空间上的 BMAP_*_MAP（真实 4.0 唯一语义正确的落点）", () => {
    const mapDriver = driverFor(realShapeNamespace());
    const map = mapDriver.create(sizedContainer());
    mapDriver.setMapType(map, "normal");
    mapDriver.setMapType(map, "satellite");

    expect(fake.createdMaps[0].callLog).toContain("setMapType:B_NORMAL_MAP");
    expect(fake.createdMaps[0].callLog).toContain("setMapType:B_SATELLITE_MAP");
    expect(fake.createdMaps[0].mapType).toBe("B_SATELLITE_MAP");
  });

  it("命名空间没有常量时退到 MapTypeId 上的同名成员（官方声明 / Fake v4 形状）", () => {
    const mapDriver = driverFor(
      realShapeNamespace({
        BMAP_NORMAL_MAP: undefined,
        BMAP_SATELLITE_MAP: undefined,
        BMAP_EARTH_MAP: undefined,
        // 官方类型包 / Fake v4 的 `MapTypeId` 形状
        MapTypeId: fake.namespace.MapTypeId,
      }),
    );
    const map = mapDriver.create(sizedContainer());
    mapDriver.setMapType(map, "normal");

    // Fake 的 `FakeV4MapTypeId.BMAP_NORMAL_MAP` 取值就是常量名本身
    expect(fake.createdMaps[0].mapType).toBe("BMAP_NORMAL_MAP");
  });

  it("不读 MapTypeId 的短键：只有短键时显式失败，而不是把卫星图静默换成混合图", () => {
    const mapDriver = driverFor(
      realShapeNamespace({
        BMAP_NORMAL_MAP: undefined,
        BMAP_SATELLITE_MAP: undefined,
        BMAP_EARTH_MAP: undefined,
      }),
    );
    const map = mapDriver.create(sizedContainer());

    expect(() => mapDriver.setMapType(map, "satellite")).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
    // 短键里的 SATELLITE 是 "B_STREET_MAP"，按它映射就会把「卫星图」变成「混合图」
    expect(fake.createdMaps[0].callLog).not.toContain("setMapType:B_STREET_MAP");
  });
});
