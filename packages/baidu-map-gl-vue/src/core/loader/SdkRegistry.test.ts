import { describe, it, expect, vi, beforeEach } from "vitest";
import { SdkRegistry } from "./SdkRegistry";
import { fingerprintConfig, type BMapLoadOptions } from "./url";

function createDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SdkRegistry", () => {
  beforeEach(() => {
    delete (window as any).BMapGL;
  });

  it("concurrent same-config loads share one promise", async () => {
    const deferred = createDeferred<any>();
    const loader = vi.fn(() => deferred.promise);
    const registry = new SdkRegistry(loader, fingerprintConfig);

    const p1 = registry.load({ ak: "a", version: "1.0" });
    const p2 = registry.load({ ak: "a", version: "1.0" });
    expect(loader).toHaveBeenCalledTimes(1);

    deferred.resolve({ BMapGL: {} });
    await p1;
    await p2;
  });

  it("removes failed entry and allows retry", async () => {
    let attempt = 0;
    const loader = vi.fn(() => {
      attempt++;
      if (attempt === 1) return Promise.reject(new Error("first fail"));
      return Promise.resolve({ ok: true });
    });
    const registry = new SdkRegistry(loader, fingerprintConfig);

    await expect(registry.load({ ak: "a" })).rejects.toThrow("first fail");
    expect(registry.size).toBe(0);
    const result = await registry.load({ ak: "a" });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it("throws config conflict when a different-config SDK is already loaded on same registry", async () => {
    const loader = vi.fn((opts: BMapLoadOptions) => {
      if (opts.ak === "a") return Promise.resolve({ v: "1.0" });
      return Promise.resolve({ v: "2.0" });
    });
    const registry = new SdkRegistry(loader, fingerprintConfig);
    await registry.load({ ak: "a", version: "1.0" });

    // 模拟全局 SDK 已经按 config-a 挂载
    (window as any).BMapGL = { v: "1.0" };

    // 请求不同 ak,应抛 conflict 而不是重新加载
    await expect(registry.load({ ak: "b", version: "1.0" })).rejects.toThrow(/config conflict/i);
  });

  it("uses existing global SDK without calling loader", async () => {
    (window as any).BMapGL = { loaded: true };
    const loader = vi.fn();
    const registry = new SdkRegistry(loader, fingerprintConfig);
    const result = await registry.load({ ak: "a" });
    expect(result).toEqual({ loaded: true });
    expect(loader).not.toHaveBeenCalled();
  });
});
