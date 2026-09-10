import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScriptLoader, getScriptKey } from "./ScriptLoader";
import type { ScriptLoaderOptions } from "./SharedLoadTask";

/** 非百度域名：避免 tests/setup.ts 对 api.map.baidu.com 的自动回调补丁。 */
const SRC = "https://sdk.example.com/bmap.js";
const SRC_WITH_CALLBACK = `${SRC}?callback=__cb_a`;

/**
 * 记录本次用例插入的 script，并把它挂到**脱离文档**的容器上，
 * 避免 happy-dom 在 appendChild 时真实拉取脚本、自动派发 load/error。
 */
function trackScripts(): HTMLScriptElement[] {
  const created: HTMLScriptElement[] = [];
  const container = document.createElement("div");
  Object.defineProperty(document, "body", { value: container, configurable: true });
  const realAppend = Node.prototype.appendChild;
  vi.spyOn(Node.prototype, "appendChild").mockImplementation(function (this: Node, node: Node) {
    if (node instanceof HTMLScriptElement) created.push(node);
    return realAppend.call(this, node as never) as never;
  });
  return created;
}

/** 脱离文档的容器里，用 parentNode 判断 script 是否仍在 DOM。 */
function isAttached(script: HTMLScriptElement): boolean {
  return script.parentNode !== null;
}

function jsonpOptions(): ScriptLoaderOptions {
  return {
    mode: "jsonp",
    src: SRC_WITH_CALLBACK,
    callbackName: "__cb_a",
    exportGetter: () => "sdk",
  };
}

describe("ScriptLoader — 显式 load/jsonp 模式", () => {
  let created: HTMLScriptElement[];

  beforeEach(() => {
    created = trackScripts();
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__cb_a;
    delete (document as unknown as Record<string, unknown>).body;
    vi.restoreAllMocks();
  });

  it("并发 20 个同配置调用只插入一个 script", async () => {
    const loader = new ScriptLoader();
    const options = jsonpOptions();
    const promises = Array.from({ length: 20 }, () => loader.load(options));

    expect(created).toHaveLength(1);
    expect(loader.inFlightCount).toBe(1);

    (window as unknown as Record<string, () => void>).__cb_a();
    const results = await Promise.all(promises);

    expect(results).toHaveLength(20);
    expect(results.every((r) => r === "sdk")).toBe(true);
    expect(loader.inFlightCount).toBe(0);
    expect(loader.completedCount).toBe(1);
    expect((window as unknown as Record<string, unknown>).__cb_a).toBeUndefined();
  });

  it("取消 19 个消费者不影响剩余消费者成功", async () => {
    const loader = new ScriptLoader();
    const options = jsonpOptions();
    const controllers = Array.from({ length: 20 }, () => new AbortController());
    const promises = controllers.map((c) => loader.load(options, c.signal));

    expect(created).toHaveLength(1);
    controllers.slice(0, 19).forEach((c) => c.abort());
    const settled = await Promise.allSettled(promises.slice(0, 19));
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    expect((settled[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "BMAP_PROVIDER_ABORTED",
    });

    // 底层任务未被取消：仍有 1 个消费者在工作。
    expect(isAttached(created[0])).toBe(true);
    expect(loader.inFlightCount).toBe(1);

    (window as unknown as Record<string, () => void>).__cb_a();
    await expect(promises[19]).resolves.toBe("sdk");
    expect(isAttached(created[0])).toBe(true);
  });

  it("最后一个消费者离开时取消底层任务，随后可重试", async () => {
    const loader = new ScriptLoader();
    const options = jsonpOptions();
    const controllers = [new AbortController(), new AbortController()];
    const promises = controllers.map((c) => loader.load(options, c.signal));

    controllers.forEach((c) => c.abort());
    await Promise.allSettled(promises);

    expect(isAttached(created[0])).toBe(false);
    expect((window as unknown as Record<string, unknown>).__cb_a).toBeUndefined();
    expect(loader.inFlightCount).toBe(0);

    const retry = loader.load(options);
    expect(created).toHaveLength(2);
    (window as unknown as Record<string, () => void>).__cb_a();
    await expect(retry).resolves.toBe("sdk");
  });

  it("jsonp 模式不依赖 script load 事件就绪", async () => {
    const loader = new ScriptLoader();
    let settled = false;
    const promise = loader.load(jsonpOptions()).then((value) => {
      settled = true;
      return value;
    });

    created[0].dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(settled).toBe(false);

    (window as unknown as Record<string, () => void>).__cb_a();
    await expect(promise).resolves.toBe("sdk");
  });

  it("load 模式以 script load 事件就绪，不安装全局回调", async () => {
    const loader = new ScriptLoader();
    const promise = loader.load({ mode: "load", src: SRC, exportGetter: () => "sdk" });
    expect(created).toHaveLength(1);
    created[0].dispatchEvent(new Event("load"));
    await expect(promise).resolves.toBe("sdk");
  });

  it("error 后移除失败缓存并可重试", async () => {
    const loader = new ScriptLoader();
    const options: ScriptLoaderOptions = { mode: "load", src: SRC, exportGetter: () => "sdk" };
    const first = loader.load(options);
    created[0].dispatchEvent(new Event("error"));
    await expect(first).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });
    expect(loader.inFlightCount).toBe(0);

    const second = loader.load(options);
    expect(created).toHaveLength(2);
    created[1].dispatchEvent(new Event("load"));
    await expect(second).resolves.toBe("sdk");
  });

  it("timeout 后移除失败缓存并可重试", async () => {
    const loader = new ScriptLoader();
    const options: ScriptLoaderOptions = {
      mode: "load",
      src: SRC,
      timeout: 15,
      exportGetter: () => "sdk",
    };
    await expect(loader.load(options)).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_TIMEOUT" });
    expect(isAttached(created[0])).toBe(false);
    expect(loader.inFlightCount).toBe(0);

    const retry = loader.load(options);
    expect(created).toHaveLength(2);
    created[1].dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBe("sdk");
  });

  it("透传 nonce/integrity/crossOrigin/referrerPolicy，remove-after-load 成功后移除 script", async () => {
    const loader = new ScriptLoader();
    const options: ScriptLoaderOptions = {
      mode: "load",
      src: SRC,
      nonce: "n1",
      integrity: "sha384-x",
      crossOrigin: "anonymous",
      referrerPolicy: "no-referrer",
      retention: "remove-after-load",
      exportGetter: () => "sdk",
    };
    const promise = loader.load(options);
    expect(created[0].nonce).toBe("n1");
    expect(created[0].integrity).toBe("sha384-x");
    expect(created[0].crossOrigin).toBe("anonymous");
    expect(created[0].referrerPolicy).toBe("no-referrer");
    created[0].dispatchEvent(new Event("load"));
    await expect(promise).resolves.toBe("sdk");
    expect(isAttached(created[0])).toBe(false);
  });

  it("同名全局 callback 冲突时，加载完成后恢复原值", async () => {
    const loader = new ScriptLoader();
    const existing = () => "existing";
    (window as unknown as Record<string, unknown>).__cb_a = existing;

    const promise = loader.load(jsonpOptions());
    expect((window as unknown as Record<string, unknown>).__cb_a).not.toBe(existing);
    (window as unknown as Record<string, () => void>).__cb_a();
    await expect(promise).resolves.toBe("sdk");
    expect((window as unknown as Record<string, unknown>).__cb_a).toBe(existing);
  });

  it("成功结果复用：再次 load 不创建新 script", async () => {
    const loader = new ScriptLoader();
    const options = jsonpOptions();
    const promise = loader.load(options);
    (window as unknown as Record<string, () => void>).__cb_a();
    await promise;

    await expect(loader.load(options)).resolves.toBe("sdk");
    expect(created).toHaveLength(1);
  });

  it("SSR（无 window/document）直接拒绝且不创建 script", async () => {
    const loader = new ScriptLoader();
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    try {
      await expect(loader.load({ mode: "load", src: SRC })).rejects.toMatchObject({
        code: "BMAP_SDK_LOAD_FAILED",
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(created).toHaveLength(0);
  });
});

describe("getScriptKey", () => {
  it("忽略 callback 名，保留其它 query", () => {
    const a = getScriptKey({
      mode: "jsonp",
      src: `${SRC}?ak=abc&callback=cb_1`,
      callbackName: "cb_1",
    });
    const b = getScriptKey({
      mode: "jsonp",
      src: `${SRC}?ak=abc&callback=cb_2`,
      callbackName: "cb_2",
    });
    const c = getScriptKey({
      mode: "jsonp",
      src: `${SRC}?ak=zzz&callback=cb_1`,
      callbackName: "cb_1",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("区分模式与完整性策略", () => {
    const load = getScriptKey({ mode: "load", src: SRC });
    const jsonp = getScriptKey({ mode: "jsonp", src: SRC, callbackName: "cb" });
    const sri = getScriptKey({ mode: "load", src: SRC, integrity: "sha384-x" });
    expect(load).not.toBe(jsonp);
    expect(load).not.toBe(sri);
  });

  it("相对 src 归一后参与去重", () => {
    const key = getScriptKey({ mode: "load", src: "/bmap/sdk.js" });
    expect(key).toContain("/bmap/sdk.js");
  });
});
