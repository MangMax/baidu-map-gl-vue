import { describe, it, expect, vi } from "vitest";
import { createClientContext } from "./client";
import { withMigrationDriver } from "../../client/migration";
import type { BMapClient } from "../../client/types";

function fakeClient(): BMapClient {
  return {
    id: Symbol("c"),
    engine: "webgl-v1",
    libraryVersion: "test",
    sdkVersion: "test",
    version: "test",
    driver: {} as never,
    capabilities: {} as never,
    loaded: { engine: "webgl-v1", namespace: {} },
    rawSdk: {},
  };
}

describe("BMapClientContext", () => {
  it("starts idle and transitions loading -> ready", async () => {
    let calls = 0;
    const ctx = createClientContext({
      definition: withMigrationDriver({
        provider: { load: async () => { calls++; return {}; } },
        loadOptions: {},
      }),
    });
    expect(ctx.status.value).toBe("idle");
    const p = ctx.load();
    expect(ctx.status.value).toBe("loading");
    const client = await p;
    expect(ctx.status.value).toBe("ready");
    expect(ctx.client.value).toEqual(client);
    expect(calls).toBe(1);
  });

  it("dedups concurrent load", async () => {
    let calls = 0;
    const ctx = createClientContext({
      definition: withMigrationDriver({
        provider: {
          load: async () => {
            calls++;
            await new Promise((r) => setTimeout(r, 10));
            return {};
          },
        },
        loadOptions: {},
      }),
    });
    const [a, b] = await Promise.all([ctx.load(), ctx.load()]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it("records error and recovers via retry", async () => {
    let fail = true;
    const ctx = createClientContext({
      definition: withMigrationDriver({
        provider: {
          load: async () => {
            if (fail) throw new Error("sdk down");
            return {};
          },
        },
        loadOptions: {},
      }),
    });
    await expect(ctx.load()).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });
    expect(ctx.status.value).toBe("error");
    expect(ctx.error.value).toBeTruthy();
    fail = false;
    const client = await ctx.retry();
    expect(ctx.status.value).toBe("ready");
    expect(client).toBeTruthy();
  });

  it("resolves immediately when constructed with a client", async () => {
    const c = fakeClient();
    const ctx = createClientContext({ client: c });
    expect(ctx.status.value).toBe("ready");
    await expect(ctx.load()).resolves.toBe(c);
  });

  it("throws a clear error without definition", async () => {
    const ctx = createClientContext({});
    await expect(ctx.load()).rejects.toMatchObject({ code: "BMAP_PARENT_CONTEXT_MISSING" });
  });

  it("dispose clears and rejects further loads", async () => {
    const ctx = createClientContext({
      definition: withMigrationDriver({ provider: { load: async () => ({}) }, loadOptions: {} }),
    });
    await ctx.load();
    ctx.dispose();
    expect(ctx.status.value).toBe("disposed");
    expect(ctx.client.value).toBeNull();
    await expect(ctx.load()).rejects.toMatchObject({ code: "BMAP_RESOURCE_DISPOSED" });
  });

  it("aborted signal rejects without error status", async () => {
    const controller = new AbortController();
    const ctx = createClientContext({
      definition: {
        provider: {
          load: async (_o, signal) => {
            await new Promise((_, rej) => signal?.addEventListener("abort", () => rej(new Error("aborted"))));
            return {};
          },
        },
        loadOptions: {},
      },
    });
    const p = ctx.load(controller.signal);
    controller.abort(new Error("cancel"));
    await expect(p).rejects.toThrow();
    vi.useRealTimers();
  });
});
