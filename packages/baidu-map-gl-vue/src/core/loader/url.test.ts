import { describe, it, expect } from "vitest";
import {
  DEFAULT_API_URL,
  DEFAULT_VERSION,
  appendCallback,
  createBaiduSdkUrl,
  fingerprintConfig,
  hash,
  normalizeApiUrl,
  resolveBrowserUrl,
} from "./url";

describe("createBaiduSdkUrl（JSAPI 4.0）", () => {
  it("默认入口为 v=4.0 且不含 type=webgl", () => {
    const url = createBaiduSdkUrl({ ak: "my-ak" }, "_init_abc", "https://example.com/");
    expect(url.toString()).toBe(
      "https://api.map.baidu.com/api?v=4.0&ak=my-ak&callback=_init_abc",
    );
    expect(url.searchParams.get("type")).toBeNull();
  });

  it("version 缺省为 4.0 基线", () => {
    const url = createBaiduSdkUrl({}, "cb", "https://example.com/");
    expect(url.searchParams.get("v")).toBe(DEFAULT_VERSION);
  });

  it("剔除 apiUrl 自带的旧 type=webgl，保留其它 query", () => {
    const url = createBaiduSdkUrl(
      { apiUrl: "https://api.map.baidu.com/api?type=webgl&ak=abc" },
      "cb",
      "https://example.com/",
    );
    expect(url.searchParams.get("type")).toBeNull();
    expect(url.searchParams.get("ak")).toBe("abc");
  });

  it("支持相对 apiUrl（基于 base 解析）", () => {
    const url = createBaiduSdkUrl(
      { apiUrl: "/bmap/api", ak: "k" },
      "cb",
      "https://corp.example.com/portal/",
    );
    expect(url.toString()).toBe("https://corp.example.com/bmap/api?v=4.0&ak=k&callback=cb");
  });

  it("保留已有 query，并用本次回调名覆盖冲突的 callback 参数", () => {
    const url = createBaiduSdkUrl(
      { apiUrl: "https://api.map.baidu.com/api?ak=abc&callback=old&lang=zh" },
      "cb",
      "https://example.com/",
    );
    expect(url.searchParams.get("lang")).toBe("zh");
    expect(url.searchParams.get("ak")).toBe("abc");
    expect(url.searchParams.getAll("callback")).toEqual(["cb"]);
  });

  it("支持自定义 callback 参数名", () => {
    const url = createBaiduSdkUrl({ callbackParam: "cb" }, "handler", "https://example.com/");
    expect(url.searchParams.get("cb")).toBe("handler");
    expect(url.searchParams.get("callback")).toBeNull();
  });
});

describe("resolveBrowserUrl / normalizeApiUrl", () => {
  it("相对 URL 基于 base 解析", () => {
    expect(resolveBrowserUrl("/a/b", "https://x.com/c/").toString()).toBe("https://x.com/a/b");
  });

  it("normalizeApiUrl 剔除回调参数", () => {
    expect(normalizeApiUrl("https://x.com/api?ak=a&callback=random")).toBe(
      "https://x.com/api?ak=a",
    );
  });
});

describe("appendCallback", () => {
  it("按 URL API 追加 callback，保留既有 query", () => {
    expect(appendCallback("https://x.com/api?ak=abc", "cb")).toBe(
      "https://x.com/api?ak=abc&callback=cb",
    );
  });

  it("支持自定义 callback 参数名", () => {
    expect(appendCallback("https://x.com/api?ak=abc", "cb", "cb2")).toBe(
      "https://x.com/api?ak=abc&cb2=cb",
    );
  });
});

describe("fingerprintConfig", () => {
  it("默认配置稳定且含 4.0 基线", () => {
    const fp = fingerprintConfig({});
    expect(fp).toBe(fingerprintConfig({}));
    expect(fp).toContain("v:4.0");
    expect(fp).toContain(DEFAULT_API_URL);
  });

  it("不同 ak / 版本 / apiUrl 产生不同指纹", () => {
    expect(fingerprintConfig({ ak: "keyA" })).not.toBe(fingerprintConfig({ ak: "keyB" }));
    expect(fingerprintConfig({ version: "4.0" })).not.toBe(fingerprintConfig({ version: "3.0" }));
    expect(fingerprintConfig({ apiUrl: "https://a.com/api" })).not.toBe(
      fingerprintConfig({ apiUrl: "https://b.com/api" }),
    );
  });

  it("AK 脱敏：指纹不包含原始 AK", () => {
    const fp = fingerprintConfig({ ak: "super-secret-ak" });
    expect(fp).not.toContain("super-secret-ak");
    expect(fp).toContain(`ak:${hash("super-secret-ak")}`);
  });
});

describe("hash", () => {
  it("不返回原始输入", () => {
    const h = hash("secret");
    expect(h).not.toBe("secret");
    expect(h).toMatch(/^[0-9a-z]+$/);
  });
});
