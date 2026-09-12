/**
 * 迁移期 Driver/Client 工厂（M3A1-CLIENT / #18）
 *
 * 覆盖三个显式入口：
 * - `normalizeMigrationProvider`：结构化结果透传、裸值按 webgl-v1 包装；
 * - `createLegacyBMapClient` / `legacyDriverFactory`：显式 legacy，只接受 webgl-v1；
 * - `migrationDriverFactory` / `withMigrationDriver`：组件默认路径按 engine 分派
 *   （因此换成 v4 Provider 不会被破坏）。
 */
import { describe, it, expect, vi } from "vitest";
import {
  createLegacyBMapClient,
  legacyDriverFactory,
  migrationDriverFactory,
  normalizeMigrationProvider,
  withMigrationDriver,
} from "./migration";
import { createBMapClient } from "./createBMapClient";
import { createFakeBMapV4 } from "../../../test-utils";
import { createLoadedJsapiV4 } from "../core/loader/providers";
import { LIBRARY_VERSION } from "../version";
import type { LoadedSdk } from "../core/loader/loaded";
import type { BMapProviderLike } from "./types";

const legacyNamespace = {
  Map: class {},
  Point: class {},
  Marker: class {},
  VERSION: "1.0",
};

const v4Namespace = createFakeBMapV4().namespace;

function loadedV4(): LoadedSdk {
  return createLoadedJsapiV4({
    providerId: "baidu-jsapi-v4",
    mode: "jsonp",
    version: "4.0",
    versionSource: "url",
    options: { ak: "test-ak-1234" },
    fingerprint: "fp-v4",
    namespace: v4Namespace,
    loadedAt: 0,
  });
}

describe("createLegacyBMapClient（显式 legacy 工厂）", () => {
  it("接受宽松 Provider（裸全局对象）并归一为结构化 legacy 结果", async () => {
    const client = await createLegacyBMapClient({
      provider: { load: async () => legacyNamespace },
      loadOptions: { ak: "x" },
    });

    expect(client.engine).toBe("webgl-v1");
    expect(client.rawSdk).toBe(legacyNamespace);
    // 版本由 Driver 探测，而不是 Loader 声明
    expect(client.sdkVersion).toBe("1.0");
    expect(client.libraryVersion).toBe(LIBRARY_VERSION);
    expect(client.capabilities.supports("overlay.marker")).toBe(true);
  });

  it("接受内置 legacy Provider 的结构化结果", async () => {
    const client = await createLegacyBMapClient({
      provider: {
        id: "baidu-cdn",
        getCacheKey: () => "fp",
        load: async () => ({ engine: "webgl-v1" as const, namespace: legacyNamespace }),
      },
      loadOptions: {},
    });
    expect(client.engine).toBe("webgl-v1");
    expect(client.sdkVersion).toBe("1.0");
  });

  it("结构化 jsapi-v4 加载结果被拒绝（提示改用默认工厂）", async () => {
    await expect(
      createLegacyBMapClient({
        provider: { load: async () => loadedV4() },
        loadOptions: {},
      }),
    ).rejects.toMatchObject({
      code: "BMAP_SDK_ENGINE_MISMATCH",
      message: expect.stringContaining("createBMapClient"),
    });
  });

  it("legacyDriverFactory 对残缺结构（有 engine 无 namespace）也明确失败", () => {
    expect(() =>
      legacyDriverFactory({
        loaded: { engine: "jsapi-v4" } as unknown as LoadedSdk,
        unsupported: "warn",
      }),
    ).toThrow(/jsapi-v4/);
  });

  it("归一保留 id / getCacheKey，避免定义漂移", async () => {
    const getCacheKey = vi.fn(() => "fp-1");
    const provider: BMapProviderLike = {
      id: "baidu-cdn",
      getCacheKey,
      load: async () => ({ engine: "webgl-v1", namespace: legacyNamespace }),
    };
    const normalized = normalizeMigrationProvider(provider);
    expect(normalized.id).toBe("baidu-cdn");
    expect(normalized.getCacheKey?.({ ak: "x" })).toBe("fp-1");
    await expect(normalized.load({ ak: "x" })).resolves.toMatchObject({ engine: "webgl-v1" });
    expect(getCacheKey).toHaveBeenCalledWith({ ak: "x" });
  });
});

describe("withMigrationDriver（组件默认路径归一）", () => {
  it("未声明 driver 时注入迁移工厂，裸 Provider 归一为结构化 legacy", async () => {
    const definition = withMigrationDriver({
      provider: { load: async () => legacyNamespace },
      loadOptions: { ak: "x" },
    });
    expect(definition.driver).toBe(migrationDriverFactory);

    const client = await createBMapClient(definition);
    expect(client.engine).toBe("webgl-v1");
    expect(client.rawSdk).toBe(legacyNamespace);
  });

  it("结构化 jsapi-v4 结果分派到 v4 工厂（Provider 换成 v4 不被破坏）", async () => {
    const definition = withMigrationDriver({
      provider: { load: async () => loadedV4() },
      loadOptions: { ak: "test-ak-1234" },
    });
    // 断言「已分派到 v4 路径」而不是被当 legacy 处理。
    // M3A2-SERVICES-NATIVE（#23）之前这里靠「v4 工厂抛 BMAP_CAPABILITY_UNSUPPORTED」间接证明；
    // 装配完成后改为**正向**证明：v4 Provider 经组件默认路径能装出可用的 v4 Client。
    const client = await createBMapClient(definition);
    expect(client.engine).toBe("jsapi-v4");
    expect(client.driver.engine).toBe("jsapi-v4");
    expect(client.driver.capabilities.supports("overlay.marker")).toBe(true);
  });

  it("显式声明 driver 时不被覆盖（双实现测试的前提）", async () => {
    const definition = withMigrationDriver({
      provider: { load: async () => legacyNamespace },
      loadOptions: {},
      driver: legacyDriverFactory,
    });
    expect(definition.driver).toBe(legacyDriverFactory);
    const client = await createBMapClient(definition);
    expect(client.engine).toBe("webgl-v1");
  });

  it("重复归一幂等：driver 保留，重复包装不会让 load 失效", async () => {
    const once = withMigrationDriver({
      provider: { load: async () => legacyNamespace },
      loadOptions: {},
    });
    const twice = withMigrationDriver(once);

    expect(twice.driver).toBe(once.driver);
    // 二次包装后仍能正常加载（结构化结果原样通过，不会被再包一层）
    const client = await createBMapClient(twice);
    expect(client.engine).toBe("webgl-v1");
    expect(client.rawSdk).toBe(legacyNamespace);
  });
});
