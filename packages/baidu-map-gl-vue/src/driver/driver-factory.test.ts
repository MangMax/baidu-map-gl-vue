/**
 * Driver 工厂与 engine 收口（M3A1-CLIENT / #18）
 *
 * `detectEngine` 是运行时猜测，已从默认 Client 路径移除；这里只保留其自身行为与
 * `createDriver` / `createJsapiV4Driver` 的显式分派契约，避免 #17 遗留行为失测。
 */
import { describe, it, expect } from "vitest";
import { createDriver, createJsapiV4Driver, detectEngine } from "./index";

const fakeSdk = { Map: class {}, Point: class {}, Marker: class {}, VERSION: "1.0" };

describe("detectEngine（advanced 逃生口，默认 Client 不再使用）", () => {
  it("按构造器区分 webgl-v1 / jsapi-v3", () => {
    expect(detectEngine(fakeSdk)).toBe("webgl-v1");
    expect(detectEngine({ MapGL: class {} })).toBe("jsapi-v3");
    expect(detectEngine(undefined)).toBe("jsapi-v4");
  });
});

describe("createDriver", () => {
  it("webgl-v1 走真实 Driver", () => {
    const driver = createDriver({ engine: "webgl-v1", rawSdk: fakeSdk });
    expect(driver.engine).toBe("webgl-v1");
    expect(driver.version).toBe("1.0");
    expect(driver.capabilities.supports("overlay.marker")).toBe(true);
  });

  it("jsapi-v4 委派 createJsapiV4Driver（Facet 未实现时明确失败）", () => {
    expect(() => createDriver({ engine: "jsapi-v4", rawSdk: fakeSdk })).toThrow(
      /M3A\.2/,
    );
  });

  it("jsapi-v3 明确不支持", () => {
    expect(() => createDriver({ engine: "jsapi-v3", rawSdk: fakeSdk })).toThrow(
      /not implemented yet/,
    );
  });
});

describe("createJsapiV4Driver", () => {
  it("保留契约并给出可执行的迁移指引", () => {
    expect(() =>
      createJsapiV4Driver({
        rawSdk: fakeSdk,
        version: "4.0",
        unsupported: "warn",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "BMAP_CAPABILITY_UNSUPPORTED",
        message: expect.stringContaining("#19~#23"),
      }),
    );
  });
});
