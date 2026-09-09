/**
 * Driver 契约测试
 *
 * 每个 Driver 实现必须通过同一套契约。
 * 通过 harness 提供 client/driver，不依赖全局 window.BMapGL。
 */
import { describe, it, expect } from "vitest";
import type { BMapClient } from "../baidu-map-gl-vue/src/client/types";
import type { MapHandle } from "../baidu-map-gl-vue/src/driver/types/handles";

export interface DriverHarness {
  client(): BMapClient;
  container(): HTMLElement;
}

export function runMapDriverContract(createHarness: () => DriverHarness) {
  describe("MapDriver contract", () => {
    it("creates and destroys a map", () => {
      const harness = createHarness();
      const map = harness.client().driver.map.create(harness.container());
      expect(map.raw).toBeTruthy();
      harness.client().driver.map.destroy(map);
    });

    it("initializes center and zoom once", () => {
      const harness = createHarness();
      const client = harness.client();
      const map = client.driver.map.create(harness.container());
      client.driver.map.initializeView(map, { center: { lng: 116.4, lat: 39.9 }, zoom: 14 });
      expect(client.driver.map.getZoom(map)).toBe(14);
      const center = client.driver.map.getCenter(map);
      expect(center.lng).toBe(116.4);
      expect(center.lat).toBe(39.9);
    });

    it("normalizes center result", () => {
      const harness = createHarness();
      const client = harness.client();
      const map = client.driver.map.create(harness.container());
      client.driver.map.setCenter(map, { lng: 121.5, lat: 31.2 });
      const center = client.driver.map.getCenter(map);
      expect(center).toEqual({ lng: 121.5, lat: 31.2 });
    });

    it("returns disposer for events", () => {
      const harness = createHarness();
      const client = harness.client();
      const map = client.driver.map.create(harness.container());
      const listener = () => {};
      const dispose = client.driver.events.on(map, "click", listener);
      dispose();
    });

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
  });
}

export function expectMapHandle(map: unknown): asserts map is MapHandle {
  expect(typeof (map as MapHandle).raw).not.toBe("undefined");
}
