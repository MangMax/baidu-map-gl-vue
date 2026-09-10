/**
 * JSAPI 4.0 命名空间边界与 LoadedJsapiV4 组装
 *
 * 覆盖 M3A1-PROVIDERS（issue #17）的边界规则：最小成员校验（Map / Point / Marker）、
 * 版本来源探测与 4.x 断言、metadata 脱敏与默认值。
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  JSAPI_V4_DOMAIN,
  assertJsapiV4Namespace,
  assertJsapiV4Version,
  assertSupportedJsapiV4Version,
  findMissingJsapiV4Members,
  isJsapiV4Namespace,
  probeJsapiV4Version,
  readJsapiV4Global,
  requireJsapiV4Global,
  resolveExistingJsapiV4Version,
} from "./namespace";
import { EXISTING_GLOBAL_URL, akRef, createLoadedJsapiV4 } from "./loaded";
import { BMapError } from "../../errors/BMapError";
import { DEFAULT_VERSION } from "../url";

function installGlobal(value: unknown): void {
  (globalThis as { BMap?: unknown }).BMap = value;
}

afterEach(() => {
  delete (globalThis as { BMap?: unknown }).BMap;
});

describe("readJsapiV4Global", () => {
  it("未加载时返回 undefined，加载后返回全局对象", () => {
    expect(readJsapiV4Global()).toBeUndefined();
    const namespace = { Map: () => {}, Point: () => {}, Marker: () => {} };
    installGlobal(namespace);
    expect(readJsapiV4Global()).toBe(namespace);
  });
});

describe("最小成员校验", () => {
  const complete = { Map: () => {}, Point: () => {}, Marker: () => {} };

  it("完整命名空间通过校验", () => {
    expect(findMissingJsapiV4Members(complete)).toEqual([]);
    expect(isJsapiV4Namespace(complete)).toBe(true);
  });

  it("缺失成员被逐个列出，且请求失败可重试", () => {
    expect(findMissingJsapiV4Members({ Map: () => {} })).toEqual(["Point", "Marker"]);
    expect(findMissingJsapiV4Members({ Map: () => {}, Point: () => {}, Marker: null })).toEqual([
      "Marker",
    ]);

    const error = (() => {
      try {
        assertJsapiV4Namespace({ Map: () => {}, Point: () => {} }, "existing-global-v4");
        return undefined;
      } catch (e) {
        return e as BMapError;
      }
    })();
    expect(error).toBeInstanceOf(BMapError);
    expect(error?.code).toBe("BMAP_SDK_LOAD_FAILED");
    expect(error?.retryable).toBe(true);
    expect(error?.message).toContain("Marker");
    expect(error?.message).toContain("existing-global-v4");
  });

  it("非对象值一律视为缺失全部成员", () => {
    expect(findMissingJsapiV4Members(undefined)).toEqual(["Map", "Point", "Marker"]);
    expect(findMissingJsapiV4Members("BMap")).toEqual(["Map", "Point", "Marker"]);
  });
});

describe("requireJsapiV4Global", () => {
  const complete = { Map: () => {}, Point: () => {}, Marker: () => {} };

  it("script 就绪后返回命名空间", () => {
    installGlobal(complete);
    expect(requireJsapiV4Global("baidu-jsapi-v4")).toBe(complete);
  });

  it("脚本就绪但全局缺失 / 不完整时统一失败", () => {
    expect(() => requireJsapiV4Global("baidu-jsapi-v4")).toThrow(/namespace is missing/);
    installGlobal({ Map: () => {} });
    expect(() => requireJsapiV4Global("baidu-jsapi-v4")).toThrow(/missing member/);
  });
});

describe("assertSupportedJsapiV4Version", () => {
  it("未声明版本时放行（走 4.0 基线）", () => {
    expect(() => assertSupportedJsapiV4Version({}, "p")).not.toThrow();
  });

  it("声明的版本必须是 4.x", () => {
    expect(() => assertSupportedJsapiV4Version({ version: "4.0" }, "p")).not.toThrow();
    expect(() => assertSupportedJsapiV4Version({ version: "1.0" }, "p")).toThrow(/not JSAPI 4\.0/);
  });
});

describe("版本来源", () => {
  it("尽力从全局探测版本，非字符串忽略", () => {
    expect(probeJsapiV4Version({ VERSION: "4.0.4" })).toBe("4.0.4");
    expect(probeJsapiV4Version({ version: "4.1" })).toBe("4.1");
    expect(probeJsapiV4Version({ VERSION: 4, version: "" })).toBeUndefined();
    expect(probeJsapiV4Version(undefined)).toBeUndefined();
  });

  it("探测到 4.x 标注 global，探测不到回退声明值", () => {
    expect(resolveExistingJsapiV4Version({ VERSION: "4.0.4" }, "p")).toEqual({
      version: "4.0.4",
      source: "global",
    });
    expect(resolveExistingJsapiV4Version({ Map: 1 }, "p")).toEqual({
      version: DEFAULT_VERSION,
      source: "declared",
    });
    expect(resolveExistingJsapiV4Version({ Map: 1 }, "p", "4.0")).toEqual({
      version: "4.0",
      source: "declared",
    });
  });

  it("非 4.x 版本直接失败（Stable 单引擎）", () => {
    expect(() => assertJsapiV4Version("1.0", "p")).toThrow(/not JSAPI 4\.0/);
    expect(() => resolveExistingJsapiV4Version({ VERSION: "3.0" }, "p")).toThrow(BMapError);
    expect(assertJsapiV4Version("4.0.4", "p")).toBe("4.0.4");
  });
});

describe("createLoadedJsapiV4", () => {
  it("组装 engine / version / namespace / load metadata", () => {
    const namespace = { Map: () => {}, Point: () => {}, Marker: () => {} };
    const loaded = createLoadedJsapiV4({
      providerId: "baidu-jsapi-v4",
      mode: "jsonp",
      version: "4.0",
      versionSource: "url",
      options: { ak: "ak-abcdef1234" },
      fingerprint: "fp",
      apiUrl: "https://api.map.baidu.com/api?v=4.0&ak=ak-abcdef1234&callback=cb",
      namespace,
      loadedAt: 1234,
    });

    expect(loaded.engine).toBe("jsapi-v4");
    expect(loaded.version).toBe("4.0");
    expect(loaded.namespace).toBe(namespace);
    expect(loaded.load).toEqual({
      providerId: "baidu-jsapi-v4",
      domain: JSAPI_V4_DOMAIN,
      mode: "jsonp",
      versionSource: "url",
      apiUrl: "https://api.map.baidu.com/api?v=4.0&ak=***1234",
      akRef: "***1234",
      fingerprint: "fp",
      loadedAt: 1234,
    });
    expect(JSON.stringify(loaded.load)).not.toContain("ak-abcdef1234");
  });

  it("复用已有全局时用占位 URL，缺 AK 时标注 none", () => {
    const loaded = createLoadedJsapiV4({
      providerId: "existing-global-v4",
      mode: "existing-global",
      version: "4.0",
      versionSource: "declared",
      options: {},
      fingerprint: "fp",
      namespace: { Map: 1 },
    });
    expect(loaded.load.apiUrl).toBe(EXISTING_GLOBAL_URL);
    expect(loaded.load.akRef).toBe("none");
  });

  it("相对入口 URL 归一化为绝对 URL", () => {
    const loaded = createLoadedJsapiV4({
      providerId: "custom-script-v4",
      mode: "load",
      version: "4.0",
      versionSource: "declared",
      options: {},
      fingerprint: "fp",
      apiUrl: "./bmap-v4.js",
      namespace: { Map: 1 },
    });
    // 不能再是相对路径，但也不能被改写成别的位置。
    expect(loaded.load.apiUrl).not.toBe("./bmap-v4.js");
    expect(loaded.load.apiUrl).toMatch(/^https?:\/\/.+\/bmap-v4\.js$/);
  });

  it("akRef 只保留末四位", () => {
    expect(akRef("abcdef123456")).toBe("***3456");
    expect(akRef(undefined)).toBe("none");
  });
});
