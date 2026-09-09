import { describe, it, expect } from "vitest";
import { createWebGlV1GeometryDriver } from "./geometry";

describe("webgl-v1 geometry fromRawPoint", () => {
  it("passes through degree values untouched", () => {
    const driver = createWebGlV1GeometryDriver({});
    expect(driver.fromRawPoint({ lng: 116.404, lat: 39.915 })).toEqual({
      lng: 116.404,
      lat: 39.915,
    });
  });

  it("converts BD09MC meters via SDK MercatorProjection when out of range", () => {
    const convertMC2LL = (p: { lng: number; lat: number }) => ({
      lng: p.lng / 100000,
      lat: p.lat / 100000,
    });
    const driver = createWebGlV1GeometryDriver({ MercatorProjection: { convertMC2LL } });
    // 北京上地一带 MC 米制
    expect(driver.fromRawPoint({ lng: 12958175.0, lat: 4825923.0 })).toEqual({
      lng: 129.58175,
      lat: 48.25923,
    });
  });

  it("falls back to spherical-mercator inverse without SDK projection", () => {
    const driver = createWebGlV1GeometryDriver({});
    const out = driver.fromRawPoint({ lng: 12958170.88, lat: 4820787.0 });
    // 近似逆投影:经度精确到 0.01,纬度容差 0.5(百度椭球参数与标准球面略有差异)
    expect(out.lng).toBeCloseTo(116.4, 1);
    expect(Math.abs(out.lat - 39.9)).toBeLessThan(0.5);
  });

  it("rejects null/non-finite input", () => {
    const driver = createWebGlV1GeometryDriver({});
    expect(() => driver.fromRawPoint(null)).toThrowError(/not a valid Point/);
    expect(() => driver.fromRawPoint({ lng: NaN, lat: 39.9 })).toThrowError(/not a valid Point/);
    expect(() => driver.fromRawPoint({ lng: 116.4, lat: Infinity })).toThrowError(
      /not a valid Point/,
    );
  });
});
