import { describe, it, expect, vi } from "vitest";
import { MapRuntime } from "./MapRuntime";
import { BMapError } from "../errors/BMapError";

function createDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createRuntime(overrides: Partial<MapRuntime["options"]> = {}) {
  const deferred = createDeferred<any>();
  const provider = {
    load: vi.fn(() => deferred.promise),
  };
  const createMap = vi.fn((api: unknown) => ({ api }));
  const rt = new MapRuntime({
    provider: provider as any,
    container: document.createElement("div"),
    createMap,
    ...overrides,
  });
  return { rt, deferred, provider, createMap };
}

describe("MapRuntime", () => {
  it("starts in idle and transitions loading -> ready", async () => {
    const { rt, deferred } = createRuntime();
    expect(rt.status.value).toBe("idle");
    const p = rt.mount();
    expect(rt.status.value).toBe("loading");
    deferred.resolve({ BMapGL: {} });
    const ctx = await p;
    expect(rt.status.value).toBe("ready");
    expect(ctx.api).toEqual({ BMapGL: {} });
    expect(rt.map.value).toBeTruthy();
  });

  it("whenReady returns cached context when already ready", async () => {
    const { rt, deferred, createMap } = createRuntime();
    const p = rt.mount();
    deferred.resolve({ api: "x" });
    await p;
    const ctx = await rt.whenReady();
    expect(ctx.api).toEqual({ api: "x" });
    expect(ctx.map).toEqual(createMap.mock.results[0].value);
  });

  it("whenReady before mount resolves after ready (回放 + 等待)", async () => {
    const { rt, deferred } = createRuntime();
    const before = rt.whenReady();
    const mount = rt.mount();
    deferred.resolve({ api: "x" });
    const ctx = await before;
    await mount;
    expect(ctx.api).toEqual({ api: "x" });
  });

  it("error status rejects waiters", async () => {
    const { rt, deferred } = createRuntime();
    const p = rt.mount();
    const waiter = rt.whenReady();
    deferred.reject(new Error("boom"));
    await expect(p).rejects.toThrow();
    await expect(waiter).rejects.toThrow();
    expect(rt.status.value).toBe("error");
  });

  it("dispose stops loading and rejects waiters with BMAP_RUNTIME_DISPOSED", async () => {
    const { rt, deferred } = createRuntime();
    const p = rt.mount();
    const waiter = rt.whenReady();
    rt.dispose();
    expect(rt.status.value).toBe("disposed");
    await expect(waiter).rejects.toMatchObject({ code: "BMAP_RUNTIME_DISPOSED" });
    deferred.resolve({}); // 晚到的 SDK 结果应被忽略(scope disposed)
    await expect(p).rejects.toMatchObject({ code: "BMAP_RUNTIME_DISPOSED" });
  });

  it("cannot re-mount after dispose", async () => {
    const { rt } = createRuntime();
    rt.dispose();
    await expect(rt.mount()).rejects.toMatchObject({ code: "BMAP_RUNTIME_DISPOSED" });
  });

  it("cannot mount twice concurrently without error (returns same pending)", async () => {
    const { rt, deferred } = createRuntime();
    const p1 = rt.mount();
    const p2 = rt.mount();
    expect(rt.status.value).toBe("loading");
    deferred.resolve({ ok: 1 });
    await Promise.all([p1, p2]);
    expect(rt.status.value).toBe("ready");
  });
});
