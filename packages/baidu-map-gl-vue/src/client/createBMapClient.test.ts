import { describe, it, expect, vi } from "vitest";
import { createBMapClient, normalizeProvider } from "./createBMapClient";
import { detectEngine } from "../driver";

const fakeSdk = {
  Map: class {},
  Point: class {},
  Marker: class {},
  VERSION: "1.0",
};

describe("createBMapClient", () => {
  it("loads provider, detects engine and builds driver", async () => {
    const load = vi.fn(async () => fakeSdk);
    const client = await createBMapClient({
      provider: { id: "test", load },
      loadOptions: { ak: "x" },
    });
    expect(load).toHaveBeenCalledWith({ ak: "x" }, undefined);
    expect(client.engine).toBe("webgl-v1");
    expect(client.version).toBe("1.0");
    expect(client.driver.engine).toBe("webgl-v1");
    expect(client.capabilities.supports("overlay.marker")).toBe(true);
    expect(client.rawSdk).toBe(fakeSdk);
    expect(typeof client.id).toBe("symbol");
  });

  it("passes engine override and capability overrides", async () => {
    const client = await createBMapClient({
      provider: { load: async () => fakeSdk },
      loadOptions: {},
      engine: "webgl-v1",
      capabilityOverrides: { "overlay.marker": false },
    });
    expect(client.driver.capabilities.supports("overlay.marker")).toBe(false);
  });

  it("normalizes a light provider shape", () => {
    const provider = normalizeProvider({ load: async () => fakeSdk });
    expect(provider.id).toBe("custom");
    expect(provider.getCacheKey({})).toBe("custom");
  });

  it("keeps this binding for class-based providers", async () => {
    class CustomProvider {
      readonly id = "custom-class";
      private readonly prefix = "ak:";
      getCacheKey() {
        return `${this.prefix}key`;
      }
      async load(options: { ak?: string }) {
        return { ...fakeSdk, marker: `${this.prefix}${options.ak}` };
      }
    }
    const source = new CustomProvider();
    const provider = normalizeProvider(source);
    expect(provider.getCacheKey({})).toBe("ak:key");
    const client = await createBMapClient({
      provider: source,
      loadOptions: { ak: "x" },
    });
    expect(client.engine).toBe("webgl-v1");
    expect((client.rawSdk as { marker: string }).marker).toBe("ak:x");
  });

  it("detectEngine classifies webgl by constructors", () => {
    expect(detectEngine(fakeSdk)).toBe("webgl-v1");
    expect(detectEngine({ MapGL: class {} })).toBe("jsapi-v3");
  });

  it("rejects when provider load fails", async () => {
    await expect(
      createBMapClient({
        provider: { load: async () => Promise.reject(new Error("boom")) },
        loadOptions: {},
      }),
    ).rejects.toThrow("boom");
  });
});
