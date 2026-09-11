/**
 * Driver 契约测试
 *
 * 每个 Driver 实现必须通过同一套契约。
 * 通过 harness 提供 client/driver，不依赖全局 window.BMapGL。
 *
 * 结构（M3A2-MAP / #20、M3A2-OVERLAYS / #21）：
 * - `runMapFacetContract`：**Map facet 契约**，只需要 `map` / `geometry` / `events` /
 *   `capabilities` 四个 facet，因此 v4（其余 facet 属 #21~#23）与 webgl-v1 都能跑；
 * - `runOverlayFacetContract`：**Overlay facet 契约**，只需要 `overlays` 与一个 Map 句柄，
 *   覆盖「每种基础覆盖物的 create/update/remove」「InfoWindow 专用 API」「属性分类查询」；
 * - `runMapDriverContract`：webgl-v1 时代的全量契约（额外的覆盖物 / 能力策略断言），
 *   内部复用上面两层。
 *
 * 契约只断言**两个引擎都能满足**的部分：v4 独有的策略（`BMAP_RESOURCE_DISPOSED` 之后的命令、
 * 非 Map 目标的错误码、Rectangle / CustomOverlay 等）留在引擎自己的测试里断言。
 */
import { describe, it, expect } from "vitest";
import type { BMapClient } from "../baidu-map-gl-vue/src/client/types";
import type { BMapDriver } from "../baidu-map-gl-vue/src/driver/types/bmap";
import type { MapHandle } from "../baidu-map-gl-vue/src/driver/types/handles";
import type { MapInteraction } from "../baidu-map-gl-vue/src/driver/types/map";
import type {
  OverlayDriver,
  OverlayHandle,
  OverlayTarget,
} from "../baidu-map-gl-vue/src/driver/types/overlays";
import type { Point } from "../baidu-map-gl-vue/src/driver/types/geometry";

export interface DriverHarness {
  client(): BMapClient;
  container(): HTMLElement;
}

/** Map facet 契约只需要这几个 facet，不要求 Driver 已实现覆盖物 / 控件 / 图层。 */
export type MapFacetDriver = Pick<BMapDriver, "map" | "geometry" | "events" | "capabilities">;

export interface MapFacetHarness {
  driver(): MapFacetDriver;
  container(): HTMLElement;
}

/** issue #20「交互开关」相关的全部语义项（各引擎的实现表都必须覆盖这 12 项）。 */
export const MAP_INTERACTIONS: readonly MapInteraction[] = [
  "dragging",
  "scroll-zoom",
  "inertial-dragging",
  "pinch-zoom",
  "keyboard",
  "double-click-zoom",
  "continuous-zoom",
  "resize-on-center",
  "rotate",
  "rotate-gestures",
  "tilt",
  "tilt-gestures",
];

export function runMapFacetContract(createHarness: () => MapFacetHarness) {
  describe("Map facet contract", () => {
    it("creates and destroys a map (destroy 幂等)", () => {
      const harness = createHarness();
      const map = harness.driver().map.create(harness.container());
      expect(map.raw).toBeTruthy();
      harness.driver().map.destroy(map);
      expect(() => harness.driver().map.destroy(map)).not.toThrow();
    });

    it("initializes center and zoom once, then updates each axis independently", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const map = driver.map.create(harness.container());
      driver.map.initializeView(map, { center: { lng: 116.4, lat: 39.9 }, zoom: 14 });
      expect(driver.map.getZoom(map)).toBe(14);
      expect(driver.map.getCenter(map)).toEqual({ lng: 116.4, lat: 39.9 });

      driver.map.setCenter(map, { lng: 121.5, lat: 31.2 });
      expect(driver.map.getZoom(map)).toBe(14);
      driver.map.setZoom(map, 9);
      expect(driver.map.getCenter(map)).toEqual({ lng: 121.5, lat: 31.2 });
      expect(driver.map.getZoom(map)).toBe(9);
    });

    it("round-trips heading and tilt", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const map = driver.map.create(harness.container());
      driver.map.initializeView(map, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });

      driver.map.setHeading(map, 45);
      expect(driver.map.getHeading(map)).toBe(45);
      driver.map.setTilt(map, 30);
      expect(driver.map.getTilt(map)).toBe(30);
    });

    it("normalizes bounds and size", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const map = driver.map.create(harness.container());
      driver.map.initializeView(map, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });

      const bounds = driver.map.getBounds(map);
      expect(bounds.southwest.lng).toBeLessThan(bounds.northeast.lng);
      expect(bounds.southwest.lat).toBeLessThan(bounds.northeast.lat);

      const size = driver.map.getSize(map);
      expect(Number.isFinite(size.width)).toBe(true);
      expect(Number.isFinite(size.height)).toBe(true);
      expect(size.width).toBeGreaterThanOrEqual(0);
    });

    it("round-trips projection conversions and puts the center in the middle", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const container = harness.container();
      const map = driver.map.create(container);
      driver.map.initializeView(map, { center: { lng: 116.404, lat: 39.915 }, zoom: 14 });

      const point = { lng: 116.414, lat: 39.905 };
      const pixel = driver.map.pointToPixel(map, point);
      const roundTrip = driver.map.pixelToPoint(map, pixel);
      expect(roundTrip.lng).toBeCloseTo(point.lng, 8);
      expect(roundTrip.lat).toBeCloseTo(point.lat, 8);

      const size = driver.map.getSize(map);
      expect(driver.map.pointToPixel(map, { lng: 116.404, lat: 39.915 })).toEqual({
        x: size.width / 2,
        y: size.height / 2,
      });
    });

    it("toggles every interaction and stays stable on repeats", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const map = driver.map.create(harness.container());

      // 跨引擎只断言「不抛错」：各引擎的交互项 → SDK 方法的映射细节与是否落地，
      // 由引擎自己的单测用可观察状态断言（v4 见 `driver/jsapi-v4/map.test.ts`）。
      for (const interaction of MAP_INTERACTIONS) {
        expect(() => {
          driver.map.setInteraction(map, interaction, false);
          driver.map.setInteraction(map, interaction, false);
          driver.map.setInteraction(map, interaction, true);
          driver.map.setInteraction(map, interaction, true);
        }).not.toThrow();
      }
    });

    it("applies pan / fitBounds / setViewport without losing the view", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const map = driver.map.create(harness.container());
      driver.map.initializeView(map, { center: { lng: 116.4, lat: 39.9 }, zoom: 12 });

      expect(() => {
        driver.map.panTo(map, { lng: 116.5, lat: 39.9 });
        driver.map.panBy(map, { x: 40, y: -20 });
        driver.map.fitBounds(map, {
          southwest: { lng: 116.2, lat: 39.7 },
          northeast: { lng: 116.6, lat: 40.1 },
        });
        driver.map.setViewport(map, [
          { lng: 116.3, lat: 39.8 },
          { lng: 116.5, lat: 40.0 },
        ]);
        driver.map.checkResize(map);
      }).not.toThrow();

      // 视野操作之后视图仍然可读（不是被平移/取景弄成非法状态）
      const center = driver.map.getCenter(map);
      expect(Number.isFinite(center.lng)).toBe(true);
      expect(Number.isFinite(center.lat)).toBe(true);
      expect(Number.isFinite(driver.map.getZoom(map))).toBe(true);
    });

    it("creates and destroys a map in a zero-size container", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const container = harness.container();
      container.style.width = "0px";
      container.style.height = "0px";

      const map = driver.map.create(container);
      expect(map.raw).toBeTruthy();
      expect(() => driver.map.checkResize(map)).not.toThrow();
      const size = driver.map.getSize(map);
      expect(Number.isFinite(size.width)).toBe(true);
      driver.map.destroy(map);
    });

    it("returns a disposer for events", () => {
      const harness = createHarness();
      const driver = harness.driver();
      const map = driver.map.create(harness.container());
      const listener = () => {};
      const dispose = driver.events.on(map, "click", listener);
      dispose();
    });
  });
}

/** Overlay facet 契约只需要覆盖物 facet：挂载目标与 InfoWindow 宿主由 harness 提供。 */
export type OverlayFacetDriver = Pick<BMapDriver, "overlays">;

export interface OverlayFacetHarness {
  driver(): OverlayFacetDriver;
  /** 每个用例一份新的 Map 句柄（既作挂载目标，也作 InfoWindow 的宿主地图） */
  mapHandle(): MapHandle;
}

const POINT: Point = { lng: 116.4, lat: 39.9 };

/** 基础覆盖物的构造入口（issue #21 的「每种基础 Overlay 的 create/update/remove contract」）。 */
const OVERLAY_FACTORIES: ReadonlyArray<[string, (overlays: OverlayDriver) => OverlayHandle]> = [
  ["marker", (overlays) => overlays.createMarker(POINT)],
  ["label", (overlays) => overlays.createLabel("label", { position: POINT })],
  [
    "polyline",
    (overlays) =>
      overlays.createPolyline([
        { lng: 116.39, lat: 39.9 },
        { lng: 116.42, lat: 39.92 },
      ]),
  ],
  [
    "polygon",
    (overlays) =>
      overlays.createPolygon([
        { lng: 116.39, lat: 39.9 },
        { lng: 116.42, lat: 39.9 },
        { lng: 116.41, lat: 39.92 },
      ]),
  ],
  ["circle", (overlays) => overlays.createCircle(POINT, 500)],
];

export function runOverlayFacetContract(createHarness: () => OverlayFacetHarness) {
  describe("Overlay facet contract", () => {
    for (const [name, make] of OVERLAY_FACTORIES) {
      it(`creates, mounts, updates and removes a ${name}`, () => {
        const harness = createHarness();
        const overlays = harness.driver().overlays;
        const overlay = make(overlays);
        expect(overlay.raw).toBeTruthy();

        const target: OverlayTarget = { kind: "map", handle: harness.mapHandle() };
        overlays.add(target, overlay);
        expect(() => overlays.setOptions(overlay, {})).not.toThrow();
        expect(typeof overlays.show(overlay)).toBe("boolean");
        expect(() => overlays.hide(overlay)).not.toThrow();
        expect(() => overlays.remove(target, overlay)).not.toThrow();
      });
    }

    it("updates position and path through the field-level API", () => {
      const harness = createHarness();
      const overlays = harness.driver().overlays;
      const marker = overlays.createMarker(POINT);
      const polyline = overlays.createPolyline([POINT, { lng: 116.42, lat: 39.92 }]);

      expect(() => overlays.setPosition(marker, { lng: 116.5, lat: 39.9 })).not.toThrow();
      expect(() =>
        overlays.setPath(polyline, [{ lng: 116.3, lat: 39.8 }, { lng: 116.45, lat: 39.95 }]),
      ).not.toThrow();
    });

    it("opens and closes an InfoWindow through the dedicated API", () => {
      const harness = createHarness();
      const overlays = harness.driver().overlays;
      const infoWindow = overlays.createInfoWindow(document.createElement("div"), {
        width: 200,
        title: "气泡",
      });
      expect(infoWindow.raw).toBeTruthy();

      expect(() => overlays.openInfoWindow(harness.mapHandle(), infoWindow, POINT)).not.toThrow();
      expect(() => overlays.redrawInfoWindow(infoWindow)).not.toThrow();
      expect(() => overlays.closeInfoWindow(infoWindow)).not.toThrow();
    });

    it("exposes the shared property classification (mutable / recreate / unsupported)", () => {
      const harness = createHarness();
      const overlays = harness.driver().overlays;
      const marker = overlays.createMarker(POINT);

      // 元数据来自公共 `OVERLAY_DESCRIPTORS`，因此两个引擎的答案必须一致
      expect(overlays.updatePolicy(marker, "icon")).toBe("mutable");
      expect(overlays.updatePolicy(marker, "position")).toBe("mutable");
      expect(overlays.updatePolicy(marker, "enableClicking")).toBe("recreate");
      expect(overlays.updatePolicy(marker, "noSuchProperty")).toBeUndefined();
    });

    it("rejects a non-map mount target instead of silently doing nothing", () => {
      const harness = createHarness();
      const overlays = harness.driver().overlays;
      const marker = overlays.createMarker(POINT);
      expect(() => overlays.add({ kind: "marker", handle: marker }, marker)).toThrow();
      expect(() => overlays.remove({ kind: "overlay", handle: marker }, marker)).toThrow();
    });
  });
}

export function runMapDriverContract(createHarness: () => DriverHarness) {
  describe("MapDriver contract", () => {
    it("respects unsupported policy", () => {
      const harness = createHarness();
      const client = harness.client();
      expect(client.driver.capabilities.supports("overlay.marker")).toBe(true);
      expect(typeof client.driver.capabilities.explain("overlay.marker").supported).toBe("boolean");
    });

    it("creates core overlays through the driver", () => {
      const harness = createHarness();
      const client = harness.client();
      const map = client.driver.map.create(harness.container());
      const marker = client.driver.overlays.createMarker({ lng: 116.4, lat: 39.9 });
      client.driver.overlays.add({ kind: "map", handle: map }, marker);
      client.driver.overlays.setPosition(marker, { lng: 116.5, lat: 39.9 });
      client.driver.overlays.remove({ kind: "map", handle: map }, marker);
    });

    runMapFacetContract(() => {
      const harness = createHarness();
      return { driver: () => harness.client().driver, container: () => harness.container() };
    });

    runOverlayFacetContract(() => {
      const harness = createHarness();
      return {
        driver: () => harness.client().driver,
        mapHandle: () => harness.client().driver.map.create(harness.container()),
      };
    });
  });
}

export function expectMapHandle(map: unknown): asserts map is MapHandle {
  expect(typeof (map as MapHandle).raw).not.toBe("undefined");
}
