import { describe, it, expect, vi } from "vitest";
import { createBMapClient, jsapiV4DriverFactory, normalizeProvider } from "./createBMapClient";
import { createLoadedJsapiV4, type LoadedJsapiV4 } from "../core/loader/providers";
import { BMapError } from "../core/errors/BMapError";
import { LIBRARY_VERSION } from "../version";
import type { BMapDriver, BMapEngine } from "../driver/types/bmap";
import type { CapabilityRegistry } from "../driver/capability/registry";
import type { BMapDriverFactory } from "./types";

const v4Namespace = {
  Map: class {},
  Point: class {},
  Marker: class {},
};

function loadedV4(overrides: Partial<{ version: string; fingerprint: string }> = {}): LoadedJsapiV4 {
  return createLoadedJsapiV4({
    providerId: "baidu-jsapi-v4",
    mode: "jsonp",
    version: overrides.version ?? "4.0",
    versionSource: "url",
    options: { ak: "test-ak-1234" },
    fingerprint: overrides.fingerprint ?? "fp-v4",
    namespace: v4Namespace,
    loadedAt: 0,
  });
}

function stubDriver(
  engine: BMapEngine,
  version: string,
  rawSdk: unknown,
  supportsMarker = true,
): BMapDriver {
  const capabilities = {
    supports: (capability: string) => supportsMarker && capability === "overlay.marker",
  } as unknown as CapabilityRegistry;
  return { engine, version, rawSdk, capabilities } as unknown as BMapDriver;
}

describe("createBMapClient（默认 v4 收口）", () => {
  it("默认注入 createJsapiV4Driver，因此默认路径在 M3A.2 之前明确失败", async () => {
    const client = createBMapClient({
      provider: { load: async () => loadedV4() },
      loadOptions: { ak: "test-ak-1234" },
    });
    await expect(client).rejects.toThrow(BMapError);
    await expect(
      createBMapClient({
        provider: { load: async () => loadedV4() },
        loadOptions: {},
      }),
    ).rejects.toMatchObject({
      code: "BMAP_CAPABILITY_UNSUPPORTED",
      message: expect.stringContaining("M3A.2"),
    });
  });

  it("拒绝 legacy（webgl-v1）加载结果", async () => {
    await expect(
      createBMapClient({
        provider: {
          load: async () => ({ engine: "webgl-v1", namespace: v4Namespace }),
        },
        loadOptions: {},
      }),
    ).rejects.toMatchObject({
      code: "BMAP_SDK_ENGINE_MISMATCH",
      message: expect.stringContaining("createLegacyBMapClient"),
    });
  });

  it("拒绝裸 SDK unknown 加载结果（Provider 未结构化）", async () => {
    await expect(
      createBMapClient({
        provider: { load: async () => v4Namespace },
        loadOptions: {},
      }),
    ).rejects.toMatchObject({
      code: "BMAP_SDK_ENGINE_MISMATCH",
      message: expect.stringContaining("LoadedSdk"),
    });
  });

  it("注入 driver 工厂：透传加载结果、unsupported 策略与 signal", async () => {
    const controller = new AbortController();
    const load = vi.fn(async () => loadedV4());
    const factory = vi.fn<BMapDriverFactory>(({ loaded }) =>
      stubDriver("jsapi-v4", (loaded as LoadedJsapiV4).version, loaded.namespace),
    );

    const client = await createBMapClient(
      {
        provider: { id: "v4", load },
        loadOptions: { ak: "test-ak-1234" },
        driver: factory,
        unsupported: "throw",
        capabilityOverrides: { "overlay.marker": false },
      },
      controller.signal,
    );

    expect(load).toHaveBeenCalledWith({ ak: "test-ak-1234" }, controller.signal);
    expect(factory).toHaveBeenCalledWith({
      loaded: expect.objectContaining({ engine: "jsapi-v4", version: "4.0" }),
      unsupported: "throw",
      capabilityOverrides: { "overlay.marker": false },
    });
    expect(client.engine).toBe("jsapi-v4");
    expect(client.driver).toBeTruthy();
  });

  it("metadata 把组件库版本 / engine / SDK 运行时版本分开报告", async () => {
    const client = await createBMapClient({
      provider: { load: async () => loadedV4({ version: "4.0" }) },
      loadOptions: {},
      driver: ({ loaded }) =>
        stubDriver("jsapi-v4", (loaded as LoadedJsapiV4).version, loaded.namespace),
    });

    expect(client.libraryVersion).toBe(LIBRARY_VERSION);
    expect(client.engine).toBe("jsapi-v4");
    expect(client.sdkVersion).toBe("4.0");
    // 兼容别名 = sdkVersion（不是 libraryVersion）
    expect(client.version).toBe("4.0");
    expect(typeof client.id).toBe("symbol");
    expect(client.rawSdk).toBe(v4Namespace);
  });

  it("default driver factory 只接受 jsapi-v4（缺省不猜测 engine）", () => {
    expect(() =>
      jsapiV4DriverFactory({
        loaded: { engine: "webgl-v1", namespace: v4Namespace },
        unsupported: "warn",
      }),
    ).toThrow(/jsapi-v4/);
  });

  it("provider load 失败原样抛出", async () => {
    await expect(
      createBMapClient({
        provider: { load: async () => Promise.reject(new Error("boom")) },
        loadOptions: {},
      }),
    ).rejects.toThrow("boom");
  });
});

describe("normalizeProvider", () => {
  it("归一轻量 provider 形状", () => {
    const provider = normalizeProvider({ load: async () => loadedV4() });
    expect(provider.id).toBe("custom");
    expect(provider.getCacheKey({})).toBe("custom");
  });

  it("保持 class 型 Provider 的 this 绑定", async () => {
    class CustomProvider {
      readonly id = "custom-class";
      private readonly prefix = "ak:";
      getCacheKey() {
        return `${this.prefix}key`;
      }
      async load() {
        return { ...loadedV4(), marker: `${this.prefix}x` };
      }
    }
    const provider = normalizeProvider(new CustomProvider());
    expect(provider.getCacheKey({})).toBe("ak:key");
    await expect(provider.load({})).resolves.toMatchObject({ marker: "ak:x" });
  });
});
