/**
 * Driver 工厂与 engine 收口（M3A1-CLIENT / #18；M3A.2 装配收口 / #23）
 *
 * `detectEngine` 是运行时猜测，已从默认 Client 路径移除；这里只保留其自身行为与
 * `createDriver` / `createJsapiV4Driver` 的显式分派与**装配**契约。
 *
 * #23 之前 v4 分支是「明确失败」，因此那些断言写的是「抛 BMAP_CAPABILITY_UNSUPPORTED」；
 * 本 issue 完成装配后它们改为断言「真的装出全部 Facet」，并把装配后的行为锚定住
 * （否则 #25 的默认切换会缺少一条可回归的基线）。
 */
import { describe, it, expect } from "vitest";
import { createFakeBMapV4 } from "../../../test-utils";
import { createDriver, createJsapiV4Driver, detectEngine } from "./index";

const fakeSdk = { Map: class {}, Point: class {}, Marker: class {}, VERSION: "1.0" };

/** 合法的 v4 命名空间（装配需要 Map/Point/Pixel/Size/Bounds 齐全）。 */
function v4Namespace() {
  return createFakeBMapV4().namespace;
}

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

  it("jsapi-v4 委派 createJsapiV4Driver：命名空间不完整时按 SDK 边界失败", () => {
    // fakeSdk 缺 Pixel/Size/Bounds（v4 命名空间的必需成员）——错误码是「调用失败」而不是
    // 「能力不支持」：这是「加载成功但命名空间不可用」，重试没有意义。
    expect(() => createDriver({ engine: "jsapi-v4", rawSdk: fakeSdk })).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
  });

  it("jsapi-v3 明确不支持", () => {
    expect(() => createDriver({ engine: "jsapi-v3", rawSdk: fakeSdk })).toThrow(
      /not implemented yet/,
    );
  });
});

describe("createJsapiV4Driver（#23 装配）", () => {
  it("装出全部 Facet，engine/version/rawSdk 与入参一致", () => {
    const namespace = v4Namespace();
    const driver = createJsapiV4Driver({ rawSdk: namespace, version: "4.0", unsupported: "warn" });

    expect(driver.engine).toBe("jsapi-v4");
    expect(driver.version).toBe("4.0");
    expect(driver.rawSdk).toBe(namespace);
    expect(driver.capabilities.supports("overlay.marker")).toBe(true);

    for (const facet of [
      "geometry",
      "events",
      "map",
      "overlays",
      "controls",
      "layers",
      "services",
      "panorama",
      "nativeLayers",
    ] as const) {
      expect(driver[facet], `Facet ${facet} 未装配`).toBeTruthy();
    }
  });

  it("v4 独有面可用：原生图层、归一化服务调用、全景 viewer", () => {
    const namespace = v4Namespace();
    const driver = createJsapiV4Driver({ rawSdk: namespace, version: "4.0", unsupported: "warn" });

    expect(driver.nativeLayers.supports("line", "setVisible")).toBe(true);
    expect(driver.nativeLayers.supports("heatmap", "setVisible")).toBe(false);
    expect(driver.panorama.supported).toBe(true);
    expect(driver.services.createGeocoder().raw).toBeTruthy();
  });

  it("每次装配一份独立的 Handle Registry：跨 Client 句柄被拒绝", () => {
    const namespace = v4Namespace();
    const a = createJsapiV4Driver({ rawSdk: namespace, version: "4.0", unsupported: "warn" });
    const b = createJsapiV4Driver({ rawSdk: namespace, version: "4.0", unsupported: "warn" });

    const handle = a.services.createGeocoder();
    expect(() => b.services.geocode(handle, { address: "北京市海淀区中关村" })).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });

  it("命名空间缺成员时按 SDK 边界失败，并指出缺了哪些", () => {
    expect(() =>
      createJsapiV4Driver({ rawSdk: { Map: class {} }, version: "4.0", unsupported: "warn" }),
    ).toThrowError(
      expect.objectContaining({
        code: "BMAP_SDK_CALL_FAILED",
        message: expect.stringContaining("Point"),
      }),
    );
  });
});
