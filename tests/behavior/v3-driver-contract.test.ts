/**
 * Driver 契约测试 —— webgl-v1(fake SDK)
 *
 * 通过 fake SDK 驱动真实的 webgl-v1 Driver 实现,
 * 验证组件无需伪造全局 BMapGL 即可获得稳定领域接口。
 *
 * M3A1-CLIENT(#18):默认 `createBMapClient()` 已收口到 jsapi-v4,webgl-v1 必须经
 * **显式** legacy 工厂(`createLegacyBMapClient`)获取,这本身也是契约的一部分。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createLegacyBMapClient } from "../../packages/baidu-map-gl-vue/src/client";
import { createFakeBMapGl, resetLifecycleState } from "../../packages/test-utils";
import { runMapDriverContract, type DriverHarness } from "../../packages/test-utils/driver-contract";

const fake = createFakeBMapGl();

function makeClient() {
  return createLegacyBMapClient({
    provider: {
      load: async () => fake,
    },
    loadOptions: {},
  });
}

function createHarness(): DriverHarness {
  return {
    client: () => cachedClient,
    container: () => {
      const el = document.createElement("div");
      el.style.width = "300px";
      el.style.height = "300px";
      return el;
    },
  };
}

let cachedClient: Awaited<ReturnType<typeof makeClient>>;

beforeEach(async () => {
  resetLifecycleState();
  fake.stats.reset();
  cachedClient = await makeClient();
});

runMapDriverContract(createHarness);

describe("webgl-v1 driver capabilities (fake sdk)", () => {
  it("supports core capabilities and explains them", () => {
    const caps = cachedClient.capabilities;
    expect(caps.supports("overlay.marker")).toBe(true);
    expect(caps.supports("map.heading")).toBe(true);
    expect(caps.supports("map.check-resize")).toBe(true);
    const explanation = caps.explain("overlay.marker");
    expect(explanation.supported).toBe(true);
    expect(explanation.reason).toBe("supported");
    expect(caps.list()).toContain("overlay.marker");
  });

  it("reports unsupported capability as raw-member-missing", () => {
    const explanation = cachedClient.capabilities.explain("service.truck-route");
    expect(explanation.supported).toBe(false);
    expect(explanation.reason).toBe("raw-member-missing");
  });

  it("respects capability overrides", async () => {
    const client = await createLegacyBMapClient({
      provider: { load: async () => fake },
      loadOptions: {},
      capabilityOverrides: { "overlay.marker": false },
    });
    expect(client.capabilities.supports("overlay.marker")).toBe(false);
    expect(client.capabilities.explain("overlay.marker").reason).toBe("overridden");
  });

  it("require() throws with UnsupportedCapabilityError under throw policy", async () => {
    const client = await createLegacyBMapClient({
      provider: { load: async () => fake },
      loadOptions: {},
      unsupported: "throw",
    });
    expect(() => client.capabilities.require("service.truck-route")).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
  });

  it("require() is silent under silent policy", async () => {
    const client = await createLegacyBMapClient({
      provider: { load: async () => fake },
      loadOptions: {},
      unsupported: "silent",
    });
    expect(() => client.capabilities.require("service.truck-route")).not.toThrow();
  });

  it("exposes branded handles with raw escape", () => {
    const map = cachedClient.driver.map.create(createHarness().container());
    expect((map as { raw: unknown }).raw).toBeTruthy();
    expect(cachedClient.driver.engine).toBe("webgl-v1");
  });
});
