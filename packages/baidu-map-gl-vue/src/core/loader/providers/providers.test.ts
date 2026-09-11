/**
 * JSAPI 4.0 Providers（M3A1-PROVIDERS / issue #17）
 *
 * 三个 Provider 共用一份测试主体，便于把「同一冲突域」的跨 Provider 行为写在
 * 一起断言：相同配置复用同一任务、不同 AK / 版本产生结构化冲突。
 *
 * CDN 的两个用例走真实 `ScriptLoader` + happy-dom，手工触发 JSONP 回调，因此同时
 * 覆盖「就绪信号是 callback」「失败不残留全局 callback」；其余用例注入假 Loader，
 * 避免依赖 DOM 时序。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { ScriptLoader } from "../ScriptLoader";
import { resetGlobalCallbackRegistryForTests } from "../SharedLoadTask";
import type {
  ScriptJsonpModeOptions,
  ScriptLoadModeOptions,
  ScriptLoaderOptions,
} from "../SharedLoadTask";
import { SdkRegistry, resetProcessSdkRegistryForTests } from "../SdkRegistry";
import { DEFAULT_API_URL } from "../url";
import { BMapError } from "../../errors/BMapError";
import { BaiduJsapiV4Provider, baiduJsapiV4Provider } from "./BaiduJsapiV4Provider";
import { existingGlobalV4Provider } from "./ExistingGlobalV4Provider";
import { CustomScriptV4Provider, customScriptV4Provider } from "./CustomScriptV4Provider";
import { loadJsapiV4Script } from "./load";
import { resetRejectedJsapiV4GlobalsForTests } from "./namespace";

const COMPLETE_NAMESPACE = { Map: () => {}, Point: () => {}, Marker: () => {} };
const AK = "ak-abcdef123456";
/** 非 api.map.baidu.com 入口：测试里不会自动触发回调，便于手工控制就绪时机。 */
const REMOTE_SRC = "https://sdk.example.com/api";

function installGlobal(value: unknown): void {
  (globalThis as { BMap?: unknown }).BMap = value;
}

/**
 * 把 `document.body` 换成脱离文档的容器，并记录插入的 `<script>`。
 * 浏览器/happy-dom 会真的去加载 script，这里只需要观察与手动触发就绪信号。
 */
function trackScripts(): HTMLScriptElement[] {
  const created: HTMLScriptElement[] = [];
  Object.defineProperty(document, "body", {
    value: document.createElement("div"),
    configurable: true,
  });
  const realAppend = Node.prototype.appendChild;
  vi.spyOn(Node.prototype, "appendChild").mockImplementation(function (this: Node, node: Node) {
    if (node instanceof HTMLScriptElement) created.push(node);
    return realAppend.call(this, node as never) as never;
  });
  return created;
}

function jsonpCallbackNameOf(script: HTMLScriptElement): string {
  const name = new URL(script.src).searchParams.get("callback");
  if (!name) throw new Error("expected a JSONP callback parameter on the script URL");
  return name;
}

function invokeGlobalCallback(name: string): void {
  (window as unknown as Record<string, () => void>)[name]();
}

function globalCallback(name: string): unknown {
  return (window as Record<string, unknown>)[name];
}

/** 假 Loader：去掉 DOM 时序，`onReady` 模拟「脚本就绪后全局可用」。 */
function createFakeLoader(onReady?: () => void) {
  const load = vi.fn(async (options: ScriptLoaderOptions) => {
    void options;
    onReady?.();
  });
  // `clear` 属于 ScriptLoader 的公开面（Provider 在失败时用它失效过期缓存）。
  const clear = vi.fn();
  return { load, clear, loader: { load, clear } as unknown as ScriptLoader };
}

function newDomain(): SdkRegistry {
  return new SdkRegistry({ domain: "BMap" });
}

afterEach(() => {
  delete (globalThis as { BMap?: unknown }).BMap;
  delete (document as unknown as Record<string, unknown>).body;
  resetGlobalCallbackRegistryForTests();
  // 残留标记是 realm 级 WeakSet：用例之间清空，避免互相影响。
  resetRejectedJsapiV4GlobalsForTests();
});

describe("BaiduJsapiV4Provider", () => {
  it("以 JSONP callback 就绪，返回 LoadedJsapiV4 并释放全局回调", async () => {
    const created = trackScripts();
    const provider = baiduJsapiV4Provider({ registry: newDomain() });
    const promise = provider.load({ ak: AK });
    await Promise.resolve();

    expect(created).toHaveLength(1);
    const src = new URL(created[0].src);
    expect(src.searchParams.get("v")).toBe("4.0");
    expect(src.searchParams.get("type")).toBeNull();
    expect(src.searchParams.get("ak")).toBe(AK);

    const callbackName = jsonpCallbackNameOf(created[0]);
    expect(typeof globalCallback(callbackName)).toBe("function");

    installGlobal(COMPLETE_NAMESPACE);
    invokeGlobalCallback(callbackName);

    const loaded = await promise;
    expect(loaded.engine).toBe("jsapi-v4");
    expect(loaded.version).toBe("4.0");
    expect(loaded.namespace).toBe(COMPLETE_NAMESPACE);
    expect(loaded.load).toMatchObject({
      providerId: "baidu-jsapi-v4",
      domain: "BMap",
      mode: "jsonp",
      versionSource: "url",
      akRef: "***3456",
    });
    expect(loaded.load.apiUrl).toContain("v=4.0");
    expect(loaded.load.apiUrl).not.toContain(AK);
    expect(loaded.load.apiUrl).not.toContain(callbackName);
    expect(globalCallback(callbackName)).toBeUndefined();
  });

  it("脚本就绪但命名空间不可用时失败，重试会重新插入 script", async () => {
    const created = trackScripts();
    const provider = baiduJsapiV4Provider({ registry: newDomain() });

    const first = provider.load({ ak: AK });
    await Promise.resolve();
    // 回调到达时脚本已执行完，但全局命名空间仍不可用（如 AK 无权限 / 脚本行为异常）。
    invokeGlobalCallback(jsonpCallbackNameOf(created[0]));
    await expect(first).rejects.toThrow(/namespace is missing/);
    // 失败必须连底层资源一起回收：script 移除、成功缓存不得残留。
    expect(created[0].parentNode).toBeNull();

    const second = provider.load({ ak: AK });
    await Promise.resolve();
    expect(created).toHaveLength(2);
    installGlobal(COMPLETE_NAMESPACE);
    invokeGlobalCallback(jsonpCallbackNameOf(created[1]));
    await expect(second).resolves.toMatchObject({ engine: "jsapi-v4" });
  });

  it("带实参的 JSONP 回调同样必须通过成功前校验", async () => {
    const created = trackScripts();
    const provider = baiduJsapiV4Provider({ registry: newDomain() });

    const first = provider.load({ ak: AK });
    await Promise.resolve();
    const name = jsonpCallbackNameOf(created[0]);
    // 非标准 / 自托管入口可能给回调传实参：校验不能因此被绕过（回调实参优先只是取值约定）。
    (window as unknown as Record<string, (payload: unknown) => void>)[name]({ ok: true });

    await expect(first).rejects.toThrow(/namespace is missing/);
    expect(created[0].parentNode).toBeNull();

    // 失败未写入底层成功缓存：重试必须重新插入 script，并且这次能够成功。
    const second = provider.load({ ak: AK });
    await Promise.resolve();
    expect(created).toHaveLength(2);
    installGlobal(COMPLETE_NAMESPACE);
    invokeGlobalCallback(jsonpCallbackNameOf(created[1]));
    await expect(second).resolves.toMatchObject({ engine: "jsapi-v4" });
  });

  it("自建脚本残留的残缺全局不阻断重试，也不会被删除", async () => {
    const created = trackScripts();
    const provider = baiduJsapiV4Provider({ registry: newDomain() });
    const partial = { Map: () => {}, Point: () => {} };

    const first = provider.load({ ak: AK });
    await Promise.resolve();
    installGlobal(partial);
    invokeGlobalCallback(jsonpCallbackNameOf(created[0]));
    await expect(first).rejects.toThrow(/Marker/);
    expect(created[0].parentNode).toBeNull();

    // 不手动清理全局：第二次调用仍须有机会重新插入 script。
    const second = provider.load({ ak: AK });
    await Promise.resolve();
    expect(created).toHaveLength(2);
    installGlobal(COMPLETE_NAMESPACE);
    invokeGlobalCallback(jsonpCallbackNameOf(created[1]));
    await expect(second).resolves.toMatchObject({ engine: "jsapi-v4" });
    // 宿主 / 外部对象没有被本库删除。
    expect(partial).toBeDefined();
  });

  it("宿主预先存在的残缺全局明确失败，且不插入 script", async () => {
    installGlobal({ Map: () => {}, Point: () => {} });
    const fake = createFakeLoader();
    const provider = new BaiduJsapiV4Provider({ loader: fake.loader, registry: newDomain() });

    await expect(provider.load({ ak: AK })).rejects.toThrow(/Marker/);
    expect(fake.load).not.toHaveBeenCalled();
  });

  it("超时退出（未到就绪回调）也登记本次残留，重试可重新插入 script", async () => {
    const created = trackScripts();
    const provider = baiduJsapiV4Provider({ registry: newDomain() });
    const partial = { Map: () => {}, Point: () => {} };

    const first = provider.load({ ak: AK, apiUrl: REMOTE_SRC, timeout: 5 });
    await Promise.resolve();
    // 脚本已建好残缺全局，但回调始终不来 → 超时退出。
    installGlobal(partial);
    await expect(first).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_TIMEOUT" });
    expect(created[0].parentNode).toBeNull();

    // 不手动清理全局：重试必须能进入加载路径。
    const second = provider.load({ ak: AK, apiUrl: REMOTE_SRC });
    await Promise.resolve();
    expect(created).toHaveLength(2);
    installGlobal(COMPLETE_NAMESPACE);
    invokeGlobalCallback(jsonpCallbackNameOf(created[1]));
    await expect(second).resolves.toMatchObject({ engine: "jsapi-v4" });
  });

  it("取消退出（未到就绪回调）也登记本次残留，且不打掉立即重试的任务登记", async () => {
    const created = trackScripts();
    const loader = new ScriptLoader();
    const provider = baiduJsapiV4Provider({ registry: newDomain(), loader });
    const partial = { Map: () => {}, Point: () => {} };
    const c1 = new AbortController();

    const first = provider.load({ ak: AK, apiUrl: REMOTE_SRC }, c1.signal);
    await Promise.resolve();
    installGlobal(partial);
    c1.abort();
    // 同一同步回合内立即重试：不能被残留全局挡住，也不能被过期清理打掉登记。
    const retry = provider.load({ ak: AK, apiUrl: REMOTE_SRC });

    await expect(first).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    await Promise.resolve();
    expect(created).toHaveLength(2);
    expect(loader.inFlightCount).toBe(1);

    installGlobal(COMPLETE_NAMESPACE);
    invokeGlobalCallback(jsonpCallbackNameOf(created[1]));
    await expect(retry).resolves.toMatchObject({ engine: "jsapi-v4" });
  });

  it("取消一个共享 helper 消费者不会删掉其它消费者的任务登记", async () => {
    const created = trackScripts();
    const loader = new ScriptLoader();
    const base = { mode: "jsonp" as const, src: REMOTE_SRC };
    const c1 = new AbortController();

    const p1 = loadJsapiV4Script({
      loader,
      providerId: "baidu-jsapi-v4",
      signal: c1.signal,
      loadOptions: { ...base, callbackName: "__cb_shared_a" },
    });
    const p2 = loadJsapiV4Script({
      loader,
      providerId: "baidu-jsapi-v4",
      loadOptions: { ...base, callbackName: "__cb_shared_a" },
    });
    expect(created).toHaveLength(1);

    c1.abort();
    await expect(p1).rejects.toMatchObject({ code: "BMAP_PROVIDER_ABORTED" });
    expect(loader.inFlightCount).toBe(1);

    // 第三个同配置消费者仍然复用进行中的任务，不能因为前一个消费者取消而重复插入。
    const p3 = loadJsapiV4Script({
      loader,
      providerId: "baidu-jsapi-v4",
      loadOptions: { ...base, callbackName: "__cb_shared_b" },
    });
    await Promise.resolve();
    expect(created).toHaveLength(1);

    installGlobal(COMPLETE_NAMESPACE);
    invokeGlobalCallback("__cb_shared_a");
    await expect(p2).resolves.toBe(COMPLETE_NAMESPACE);
    await expect(p3).resolves.toBe(COMPLETE_NAMESPACE);
  });

  it("[T1] 失败残留标记跨库副本共享，另一份副本的重试不会被挡住", async () => {
    resetProcessSdkRegistryForTests();
    const created = trackScripts();
    const partial = { Map: () => {}, Point: () => {} };

    // 副本 A：独立求值的模块图（模拟同页两份独立打包的库副本），共用进程级 BMap 域。
    vi.resetModules();
    const namespaceA = await import("./namespace");
    const providerA = (await import("./BaiduJsapiV4Provider")).baiduJsapiV4Provider();
    const first = providerA.load({ ak: AK, apiUrl: REMOTE_SRC });
    await Promise.resolve();
    installGlobal(partial);
    invokeGlobalCallback(jsonpCallbackNameOf(created[0]));
    await expect(first).rejects.toThrow(/Marker/);
    expect(namespaceA.isRejectedJsapiV4Global(partial)).toBe(true);

    // 副本 B：同一 realm、同一进程级 Registry，必须认识 A 留下的残留。
    vi.resetModules();
    const namespaceB = await import("./namespace");
    expect(namespaceB.isRejectedJsapiV4Global(partial)).toBe(true);

    const providerB = (await import("./BaiduJsapiV4Provider")).baiduJsapiV4Provider();
    const second = providerB.load({ ak: AK, apiUrl: REMOTE_SRC });
    // 断言失败时避免留下未处理的 rejection。
    void second.catch(() => {});
    await Promise.resolve();
    expect(created).toHaveLength(2);

    installGlobal(COMPLETE_NAMESPACE);
    invokeGlobalCallback(jsonpCallbackNameOf(created[1]));
    await expect(second).resolves.toMatchObject({ engine: "jsapi-v4" });
  });

  it("命名空间缺少关键成员时失败，且不残留全局 callback", async () => {
    const created = trackScripts();
    const provider = baiduJsapiV4Provider({ registry: newDomain() });
    const promise = provider.load({ ak: AK });
    await Promise.resolve();

    const callbackName = jsonpCallbackNameOf(created[0]);
    installGlobal({ Map: () => {}, Point: () => {} });
    invokeGlobalCallback(callbackName);

    await expect(promise).rejects.toThrow(/Marker/);
    await expect(promise).rejects.toMatchObject({ code: "BMAP_SDK_LOAD_FAILED" });
    expect(globalCallback(callbackName)).toBeUndefined();
  });

  it("失败后允许重试，且不残留失败条目", async () => {
    const domain = newDomain();
    let attempt = 0;
    const load = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new BMapError("BMAP_SDK_LOAD_FAILED", "boom");
      installGlobal(COMPLETE_NAMESPACE);
    });
    const provider = new BaiduJsapiV4Provider({
      loader: { load, clear: vi.fn() } as unknown as ScriptLoader,
      registry: domain,
    });

    await expect(provider.load({ ak: AK })).rejects.toThrow("boom");
    expect(domain.size).toBe(0);
    expect(domain.activeFingerprint).toBeUndefined();

    const loaded = await provider.load({ ak: AK });
    expect(loaded.namespace).toBe(COMPLETE_NAMESPACE);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("拒绝非 4.x 的显式版本，不静默降级", async () => {
    const fake = createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE));
    const provider = new BaiduJsapiV4Provider({ loader: fake.loader, registry: newDomain() });

    await expect(provider.load({ ak: AK, version: "1.0" })).rejects.toThrow(/not JSAPI 4\.0/);
    expect(fake.load).not.toHaveBeenCalled();
  });

  it("getCacheKey 只由影响全局 SDK 的配置决定", () => {
    const provider = baiduJsapiV4Provider({ registry: newDomain() });

    // script 级细节不参与身份判定：超时不同不该被当成另一份 SDK 配置。
    expect(provider.getCacheKey({ ak: AK, timeout: 10_000 })).toBe(
      provider.getCacheKey({ ak: AK }),
    );
    // 影响全局语义的配置必须改变身份，否则冲突检测会漏判。
    expect(provider.getCacheKey({ ak: AK })).not.toBe(provider.getCacheKey({ ak: "ak-other" }));
    expect(provider.getCacheKey({ ak: AK })).not.toBe(
      provider.getCacheKey({ ak: AK, version: "4.1" }),
    );
  });

  it("不同 Provider 的相同配置复用同一任务", async () => {
    const domain = newDomain();
    const cdnFake = createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE));
    const customFake = createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE));
    const cdn = new BaiduJsapiV4Provider({ loader: cdnFake.loader, registry: domain });
    // 自托管入口指向同一地址 → 与 CDN 指纹一致，落在同一冲突域。
    const custom = new CustomScriptV4Provider(DEFAULT_API_URL, {
      loader: customFake.loader,
      registry: domain,
    });

    const first = await cdn.load({ ak: AK });
    const second = await custom.load({ ak: AK });

    expect(cdnFake.load).toHaveBeenCalledTimes(1);
    expect(customFake.load).not.toHaveBeenCalled();
    expect(second.namespace).toBe(first.namespace);
    expect(second.load.fingerprint).toBe(first.load.fingerprint);
  });

  it("不同 AK 产生结构化配置冲突，不重复加载", async () => {
    const domain = newDomain();
    const fake = createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE));
    const provider = new BaiduJsapiV4Provider({ loader: fake.loader, registry: domain });

    await provider.load({ ak: AK });
    const conflict = await provider
      .load({ ak: "ak-zzzzzzzzzzzz" })
      .catch((error: unknown) => error as BMapError);

    expect(conflict).toBeInstanceOf(BMapError);
    expect(conflict.code).toBe("BMAP_SDK_CONFIG_CONFLICT");
    expect(fake.load).toHaveBeenCalledTimes(1);
  });

  it("页面已存在完整全局时直接复用，不再插入 script", async () => {
    installGlobal(COMPLETE_NAMESPACE);
    const fake = createFakeLoader();
    const provider = new BaiduJsapiV4Provider({ loader: fake.loader, registry: newDomain() });

    const loaded = await provider.load({ ak: AK });
    expect(fake.load).not.toHaveBeenCalled();
    expect(loaded.load.mode).toBe("existing-global");
    expect(loaded.load.versionSource).toBe("declared");
  });

  it("SSR（无 window/document）导入与加载都不触碰浏览器全局", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    try {
      // 动态重新导入：模块顶层不得访问 document / window。
      vi.resetModules();
      const mod = await import("./BaiduJsapiV4Provider");
      const provider = mod.baiduJsapiV4Provider({ registry: new SdkRegistry({ domain: "BMap" }) });

      expect(provider.getCacheKey({ ak: AK })).toContain("v:4.0");
      await expect(provider.load({ ak: AK })).rejects.toMatchObject({
        code: "BMAP_SDK_LOAD_FAILED",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("ExistingGlobalV4Provider", () => {
  it("全局缺失时失败（可重试）", async () => {
    const provider = existingGlobalV4Provider({ registry: newDomain() });
    const error = await provider
      .load({ ak: AK })
      .catch((e: unknown) => e as BMapError);
    expect(error).toBeInstanceOf(BMapError);
    expect(error.code).toBe("BMAP_SDK_LOAD_FAILED");
    expect(error.retryable).toBe(true);
  });

  it("全局缺少关键成员时失败并列出缺失成员", async () => {
    installGlobal({ Map: () => {}, Point: () => {}, Marker: undefined });
    const provider = existingGlobalV4Provider({ registry: newDomain() });
    await expect(provider.load({ ak: AK })).rejects.toThrow(/Marker/);
  });

  it("全局暴露 4.x 版本时标注 versionSource=global", async () => {
    installGlobal({ ...COMPLETE_NAMESPACE, VERSION: "4.0.4" });
    const loaded = await existingGlobalV4Provider({ registry: newDomain() }).load({ ak: AK });
    expect(loaded.version).toBe("4.0.4");
    expect(loaded.load.versionSource).toBe("global");
    expect(loaded.load.mode).toBe("existing-global");
    expect(loaded.load.apiUrl).toBe("existing-global");
  });

  it("全局暴露非 4.x 版本时失败", async () => {
    installGlobal({ ...COMPLETE_NAMESPACE, VERSION: "2.0" });
    await expect(existingGlobalV4Provider({ registry: newDomain() }).load({ ak: AK })).rejects.toThrow(
      /not JSAPI 4\.0/,
    );
  });

  it("与同一域内的其它 Provider 共享冲突判定", async () => {
    installGlobal(COMPLETE_NAMESPACE);
    const domain = newDomain();
    const provider = existingGlobalV4Provider({ registry: domain });
    await provider.load({ ak: AK });

    const cdn = new BaiduJsapiV4Provider({
      loader: createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE)).loader,
      registry: domain,
    });
    await expect(cdn.load({ ak: "ak-zzzzzzzzzzzz" })).rejects.toMatchObject({
      code: "BMAP_SDK_CONFIG_CONFLICT",
    });
  });
});

describe("CustomScriptV4Provider", () => {
  it("默认按 script load 事件就绪，并把相对入口归一化为绝对 URL", async () => {
    const fake = createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE));
    const provider = customScriptV4Provider("./bmap-v4.js", {
      loader: fake.loader,
      registry: newDomain(),
    });

    const loaded = await provider.load({ ak: AK });
    const options = fake.load.mock.calls[0][0] as ScriptLoadModeOptions;
    expect(options.mode).toBe("load");
    expect(options.src).toBe("./bmap-v4.js");
    expect(loaded.load.mode).toBe("load");
    // metadata 记录的是归一化后的绝对入口，而不是原样透传的相对路径。
    expect(loaded.load.apiUrl).not.toBe("./bmap-v4.js");
    expect(loaded.load.apiUrl).toMatch(/^https?:\/\/.+\/bmap-v4\.js$/);
  });

  it("就绪信号只能显式指定：传 apiUrl 不会自动切成 JSONP", async () => {
    const fake = createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE));
    const provider = customScriptV4Provider("./bmap-v4.js", {
      loader: fake.loader,
      registry: newDomain(),
    });

    await provider.load({ ak: AK, apiUrl: "https://corp.example.com/bmap/api" });
    expect((fake.load.mock.calls[0][0] as ScriptLoadModeOptions).mode).toBe("load");
  });

  it("显式 jsonp 时把回调名写进入口 URL，并支持自定义 callback 参数名", async () => {
    const fake = createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE));
    const provider = customScriptV4Provider("https://corp.example.com/bmap/api", {
      loader: fake.loader,
      registry: newDomain(),
      mode: "jsonp",
    });

    const loaded = await provider.load({ ak: AK, callbackParam: "cb" });
    const options = fake.load.mock.calls[0][0] as ScriptJsonpModeOptions;
    expect(options.mode).toBe("jsonp");
    expect(new URL(options.src).searchParams.get("cb")).toBe(options.callbackName);
    expect(loaded.load.mode).toBe("jsonp");
    // metadata 中的入口 URL 已剔除回调参数。
    expect(loaded.load.apiUrl).not.toContain(options.callbackName);
  });

  it("load 模式下普通 callback 参数参与配置身份，jsonp 模式下由 Loader 接管", () => {
    const loadA = customScriptV4Provider("/sdk.js?callback=tenantA", { registry: newDomain() });
    const loadB = customScriptV4Provider("/sdk.js?callback=tenantB", { registry: newDomain() });
    // load 模式没有库管理的回调，该参数只是普通 query：不同入口必须是不同配置。
    expect(loadA.getCacheKey({})).not.toBe(loadB.getCacheKey({}));

    const jsonpA = customScriptV4Provider("/sdk.js?callback=tenantA", {
      registry: newDomain(),
      mode: "jsonp",
    });
    const jsonpB = customScriptV4Provider("/sdk.js?callback=tenantB", {
      registry: newDomain(),
      mode: "jsonp",
    });
    // jsonp 模式下该参数会被本次回调名覆盖，因此不参与身份判定。
    expect(jsonpA.getCacheKey({})).toBe(jsonpB.getCacheKey({}));
  });

  it("空 scriptSrc 直接拒绝", () => {
    expect(() => customScriptV4Provider("")).toThrow(BMapError);
    expect(() => customScriptV4Provider("")).toThrow(/non-empty scriptSrc/);
  });

  it("自托管入口的版本校验也发生在成功提交之前（失败可重试）", async () => {
    const created = trackScripts();
    const provider = customScriptV4Provider("https://sdk.example.com/api?v=4.0", {
      registry: newDomain(),
      mode: "load",
    });

    const first = provider.load({ ak: AK });
    await Promise.resolve();
    // 成员完整但版本不是 4.x：必须在底层提交成功之前被拒绝。
    installGlobal({ ...COMPLETE_NAMESPACE, VERSION: "3.0" });
    created[0].dispatchEvent(new Event("load"));
    await expect(first).rejects.toThrow(/not JSAPI 4\.0/);
    expect(created[0].parentNode).toBeNull();

    const second = provider.load({ ak: AK });
    await Promise.resolve();
    expect(created).toHaveLength(2);
    installGlobal(COMPLETE_NAMESPACE);
    created[1].dispatchEvent(new Event("load"));
    await expect(second).resolves.toMatchObject({ engine: "jsapi-v4" });
  });

  it("自托管入口的版本以全局自述为准", async () => {
    const fake = createFakeLoader(() => installGlobal({ ...COMPLETE_NAMESPACE, VERSION: "4.0.4" }));
    const loaded = await customScriptV4Provider("./bmap-v4.js", {
      loader: fake.loader,
      registry: newDomain(),
    }).load({ ak: AK });

    expect(loaded.version).toBe("4.0.4");
    expect(loaded.load.versionSource).toBe("global");
  });
});
