/**
 * SdkRegistry —— 进程级冲突域
 *
 * 覆盖 M3A1-PROVIDERS（issue #17）的 registry 语义：
 * - 同域同指纹复用同一任务，不同域互不影响；
 * - 域内已就绪配置与请求配置不一致时按策略处理，默认 `throw`；
 * - 失败 / 取消后条目移除，可重试；
 * - 不依赖 window / document（SSR 导入安全）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SdkRegistry,
  getProcessSdkRegistry,
  resetProcessSdkRegistryForTests,
  type SdkConflictInfo,
} from "./SdkRegistry";
import { fingerprintConfig } from "./url";
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

const CONFIG_A = fingerprintConfig({ ak: "ak-aaaaaaaa", version: "4.0" });
const CONFIG_B = fingerprintConfig({ ak: "ak-bbbbbbbb", version: "4.0" });

describe("SdkRegistry", () => {
  beforeEach(() => {
    resetProcessSdkRegistryForTests();
  });

  afterEach(() => {
    resetProcessSdkRegistryForTests();
  });

  it("concurrent same-fingerprint loads share one task", async () => {
    const deferred = createDeferred<unknown>();
    const loader = vi.fn(() => deferred.promise);
    const registry = new SdkRegistry({ domain: "BMap" });

    const p1 = registry.load({ fingerprint: CONFIG_A, loader });
    const p2 = registry.load({ fingerprint: CONFIG_A, loader });
    // 条目先登记、任务按微任务启动：并发调用只会启动一次 loader。
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);

    const value = { Map: 1 };
    deferred.resolve(value);
    await expect(p1).resolves.toBe(value);
    await expect(p2).resolves.toBe(value);
  });

  it("serves the ready result without re-running the loader", async () => {
    const loader = vi.fn(async () => "sdk");
    const registry = new SdkRegistry();

    await registry.load({ fingerprint: CONFIG_A, loader });
    await expect(registry.load({ fingerprint: CONFIG_A, loader })).resolves.toBe("sdk");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(registry.activeFingerprint).toBe(CONFIG_A);
  });

  it("removes failed entry and allows retry", async () => {
    let attempt = 0;
    const loader = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error("first fail");
      return { ok: true };
    });
    const registry = new SdkRegistry();

    await expect(registry.load({ fingerprint: CONFIG_A, loader })).rejects.toThrow("first fail");
    expect(registry.size).toBe(0);
    expect(registry.activeFingerprint).toBeUndefined();

    await expect(registry.load({ fingerprint: CONFIG_A, loader })).resolves.toEqual({ ok: true });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("throws structured config conflict across providers in the same domain", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const loader = vi.fn(async () => "sdk");

    await registry.load({ fingerprint: CONFIG_A, loader });
    // 同域内另一个 Provider 用不同配置请求：必须冲突，而不是重新加载。
    const conflict = await registry
      .load({ fingerprint: CONFIG_B, loader })
      .catch((error: unknown) => error);

    expect(conflict).toBeInstanceOf(BMapError);
    expect((conflict as BMapError).code).toBe("BMAP_SDK_CONFIG_CONFLICT");
    expect((conflict as BMapError).retryable).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not leak AK in conflict diagnostics", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    await registry.load({
      fingerprint: fingerprintConfig({ ak: "SECRET_AK_123456" }),
      loader: async () => "sdk",
    });

    const conflict = await registry
      .load({
        fingerprint: fingerprintConfig({ ak: "SECRET_AK_999999" }),
        loader: async () => "sdk",
      })
      .catch((error: unknown) => error as BMapError);

    expect((conflict as BMapError).message).not.toContain("SECRET_AK_999999");
    expect((conflict as BMapError).message).toContain("SDK config conflict");
  });

  it("honours an explicitly configured non-throwing policy", async () => {
    const conflicts: SdkConflictInfo[] = [];
    const registry = new SdkRegistry({
      domain: "BMap",
      conflictPolicy: "ignore",
      onConflict: (info) => conflicts.push(info),
    });

    await registry.load({ fingerprint: CONFIG_A, loader: async () => "a" });
    await expect(registry.load({ fingerprint: CONFIG_B, loader: async () => "b" })).resolves.toBe(
      "b",
    );

    expect(conflicts).toEqual([{ domain: "BMap", requested: CONFIG_B, active: CONFIG_A }]);
    // 域内已就绪配置不被后来的请求改写。
    expect(registry.activeFingerprint).toBe(CONFIG_A);
  });

  it("honours the policy configured when the process domain is created", async () => {
    const onConflict = vi.fn();
    // 兼容策略只能通过显式配置开启；进程级域在首次创建时固化该策略。
    const registry = getProcessSdkRegistry("BMap", {
      domain: "BMap",
      conflictPolicy: "warn",
      onConflict,
    });

    await registry.load({ fingerprint: CONFIG_A, loader: async () => "a" });
    await expect(registry.load({ fingerprint: CONFIG_B, loader: async () => "b" })).resolves.toBe(
      "b",
    );
    expect(onConflict).toHaveBeenCalledWith({
      domain: "BMap",
      requested: CONFIG_B,
      active: CONFIG_A,
    });
    expect(registry.policy).toBe("warn");
  });

  it("defaults to throw so compatibility policies never become implicit", () => {
    expect(new SdkRegistry({ domain: "BMap" }).policy).toBe("throw");
  });

  it("rejects a second consumer that aborts, without touching the others", async () => {
    const deferred = createDeferred<unknown>();
    const loader = vi.fn(() => deferred.promise);
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    const c2 = new AbortController();

    const p1 = registry.load({ fingerprint: CONFIG_A, loader }, c1.signal);
    const p2 = registry.load({ fingerprint: CONFIG_A, loader }, c2.signal);

    c1.abort();
    await expect(p1).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });

    const value = { Map: 1 };
    deferred.resolve(value);
    // 未取消的消费者不受影响：取消必须与消费者一一对应，而不是由第一个调用者控制所有人。
    await expect(p2).resolves.toBe(value);
  });

  it("cancels the underlying task only after the last consumer leaves", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    const c2 = new AbortController();
    let underlyingAborted = false;
    const loader = vi.fn(
      (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              underlyingAborted = true;
              reject(new BMapError("BMAP_PROVIDER_ABORTED", "aborted"));
            },
            { once: true },
          );
        }),
    );

    const p1 = registry.load({ fingerprint: CONFIG_A, loader }, c1.signal);
    const p2 = registry.load({ fingerprint: CONFIG_A, loader }, c2.signal);
    // 条目先登记、任务按微任务启动：并发调用只会启动一次 loader。
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);

    c1.abort();
    await expect(p1).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    expect(underlyingAborted).toBe(false);

    c2.abort();
    await expect(p2).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    expect(underlyingAborted).toBe(true);
    // 最后一个消费者离开后条目释放，允许下次重试。
    expect(registry.size).toBe(0);
    await expect(registry.load({ fingerprint: CONFIG_A, loader: vi.fn(async () => "sdk") })).resolves.toBe(
      "sdk",
    );
  });

  it("rejects a concurrent request with a different config before starting its loader", async () => {
    const deferred = createDeferred<unknown>();
    const loaderA = vi.fn(() => deferred.promise);
    const loaderB = vi.fn(async () => "sdk-b");
    const registry = new SdkRegistry({ domain: "BMap" });

    const p1 = registry.load({ fingerprint: CONFIG_A, loader: loaderA });
    const p2 = registry.load({ fingerprint: CONFIG_B, loader: loaderB });

    // 域内已有正在加载的配置：不兼容的请求必须在启动 loader 之前被拒绝。
    await expect(p2).rejects.toMatchObject({ code: "BMAP_SDK_CONFIG_CONFLICT" });
    expect(loaderB).not.toHaveBeenCalled();

    deferred.resolve("sdk-a");
    await expect(p1).resolves.toBe("sdk-a");
  });

  it("frees the in-flight config after a failure so a retry can start", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const failing = vi.fn(async () => {
      throw new Error("first fail");
    });

    await expect(registry.load({ fingerprint: CONFIG_A, loader: failing })).rejects.toThrow(
      "first fail",
    );
    // 占用已释放：另一份配置现在可以正常加载。
    await expect(registry.load({ fingerprint: CONFIG_B, loader: async () => "b" })).resolves.toBe("b");
  });

  it("releases the entry synchronously so an immediate retry starts a new task", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    const hangingLoader = vi.fn(
      (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new BMapError("BMAP_PROVIDER_ABORTED", "aborted")),
            { once: true },
          );
        }),
    );

    const first = registry.load({ fingerprint: CONFIG_A, loader: hangingLoader }, c1.signal);
    await Promise.resolve();

    c1.abort();
    // 不等待任何异步收尾：立即用同一配置重试，必须启动新任务而不是订阅已取消的任务。
    const retry = vi.fn(async () => "sdk-retry");
    const same = registry.load({ fingerprint: CONFIG_A, loader: retry });

    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    await expect(same).resolves.toBe("sdk-retry");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("releases the occupancy synchronously so another config can load right away", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    const c1 = new AbortController();
    const hangingLoader = vi.fn(
      (signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new BMapError("BMAP_PROVIDER_ABORTED", "aborted")),
            { once: true },
          );
        }),
    );

    const first = registry.load({ fingerprint: CONFIG_A, loader: hangingLoader }, c1.signal);
    await Promise.resolve();

    c1.abort();
    const other = vi.fn(async () => "sdk-other");
    const second = registry.load({ fingerprint: CONFIG_B, loader: other });

    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    await expect(second).resolves.toBe("sdk-other");
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("keeps enforcement after clear() and isolates domains", async () => {
    const registry = new SdkRegistry({ domain: "BMap" });
    await registry.load({ fingerprint: CONFIG_A, loader: async () => "a" });
    registry.clear();
    expect(registry.size).toBe(0);
    await expect(registry.load({ fingerprint: CONFIG_B, loader: async () => "b" })).rejects.toThrow(
      /config conflict/,
    );

    // 不同域各自持有一份「已就绪配置」，互不冲突。
    const other = new SdkRegistry({ domain: "BMapGL" });
    await expect(other.load({ fingerprint: CONFIG_B, loader: async () => "b" })).resolves.toBe("b");
  });

  it("shares one registry per process domain and resets for tests", async () => {
    const first = getProcessSdkRegistry("BMap", { domain: "BMap" });
    const second = getProcessSdkRegistry("BMap", { domain: "BMap" });
    expect(second).toBe(first);

    const otherDomain = getProcessSdkRegistry("BMapGL", { domain: "BMapGL" });
    expect(otherDomain).not.toBe(first);

    await first.load({ fingerprint: CONFIG_A, loader: async () => "a" });
    expect(first.activeFingerprint).toBe(CONFIG_A);
    expect(otherDomain.activeFingerprint).toBeUndefined();

    resetProcessSdkRegistryForTests();
    expect(getProcessSdkRegistry("BMap", { domain: "BMap" })).not.toBe(first);
  });
});
