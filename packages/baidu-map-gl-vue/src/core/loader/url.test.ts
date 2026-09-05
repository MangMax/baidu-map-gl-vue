import { describe, it, expect } from "vitest";
import { createBaiduSdkUrl, appendCallback, fingerprintConfig, hash } from "./url";

describe("createBaiduSdkUrl", () => {
  it("builds a URL with webgl type, version, ak and callback", () => {
    const url = createBaiduSdkUrl({ ak: "my-ak", version: "1.0" }, "_init_abc");
    expect(url.toString()).toBe(
      "https://api.map.baidu.com/api?type=webgl&v=1.0&ak=my-ak&callback=_init_abc",
    );
  });
});

describe("appendCallback", () => {
  it("appends callback via URL API without trailing &", () => {
    expect(appendCallback("https://x.com/api?ak=abc", "cb")).toBe(
      "https://x.com/api?ak=abc&callback=cb",
    );
  });
});

describe("fingerprintConfig", () => {
  it("produces stable fingerprint including ak hash", () => {
    const a = fingerprintConfig({ ak: "keyA", version: "1.0" });
    const b = fingerprintConfig({ ak: "keyA", version: "1.0" });
    expect(a).toBe(b);
  });

  it("differs for different ak", () => {
    const a = fingerprintConfig({ ak: "keyA" });
    const b = fingerprintConfig({ ak: "keyB" });
    expect(a).not.toBe(b);
  });

  it("returns default when no meaningful config", () => {
    expect(fingerprintConfig({})).toBe("default");
  });
});

describe("hash", () => {
  it("never returns the raw input", () => {
    const h = hash("secret");
    expect(h).not.toBe("secret");
    expect(h).toMatch(/^[0-9a-z]+$/);
  });
});
