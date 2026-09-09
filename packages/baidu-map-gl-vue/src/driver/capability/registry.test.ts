import { describe, it, expect, vi } from "vitest";
import { createCapabilityRegistry } from "./registry";
import { UnsupportedCapabilityError } from "./unsupported";
import { CAPABILITY_IDS } from "./catalog";

const fakeSdk = {
  Map: class {},
  Marker: class {},
  InfoWindow: class {},
  setHeading: () => {},
  setTilt: () => {},
  checkResize: () => {},
  VERSION: "1.0",
};

describe("CapabilityRegistry", () => {
  it("detects raw members on namespace and Map prototype", () => {
    const registry = createCapabilityRegistry({
      engine: "webgl-v1",
      version: "1.0",
      rawSdk: fakeSdk,
      unsupported: "silent",
    });
    expect(registry.supports("overlay.marker")).toBe(true);
    expect(registry.supports("map.heading")).toBe(true);
    expect(registry.supports("service.truck-route")).toBe(false);
  });

  it("engine whitelist gates capability", () => {
    const registry = createCapabilityRegistry({
      engine: "jsapi-v3",
      version: "1.0",
      rawSdk: fakeSdk,
      unsupported: "silent",
    });
    expect(registry.supports("map.heading")).toBe(false);
    expect(registry.explain("map.heading").reason).toBe("engine-unsupported");
  });

  it("list() returns only supported capabilities", () => {
    const registry = createCapabilityRegistry({
      engine: "webgl-v1",
      version: "1.0",
      rawSdk: fakeSdk,
      unsupported: "silent",
    });
    const listed = registry.list();
    expect(listed).toContain("overlay.marker");
    expect(listed).not.toContain("service.truck-route");
    expect(listed.every((id) => CAPABILITY_IDS.includes(id))).toBe(true);
  });

  it("require() throw policy throws UnsupportedCapabilityError", () => {
    const registry = createCapabilityRegistry({
      engine: "webgl-v1",
      version: "1.0",
      rawSdk: fakeSdk,
      unsupported: "throw",
    });
    expect(() => registry.require("service.truck-route")).toThrow(UnsupportedCapabilityError);
  });

  it("require() warn policy logs and does not throw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = createCapabilityRegistry({
      engine: "webgl-v1",
      version: "1.0",
      rawSdk: fakeSdk,
      unsupported: "warn",
    });
    expect(() => registry.require("service.truck-route")).not.toThrow();
    warn.mockRestore();
  });

  it("overrides take precedence", () => {
    const registry = createCapabilityRegistry({
      engine: "webgl-v1",
      version: "1.0",
      rawSdk: fakeSdk,
      unsupported: "silent",
      overrides: { "overlay.marker": false, "service.truck-route": true },
    });
    expect(registry.supports("overlay.marker")).toBe(false);
    expect(registry.supports("service.truck-route")).toBe(true);
  });
});
