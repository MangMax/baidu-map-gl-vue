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
import { SdkRegistry } from "../SdkRegistry";
import { DEFAULT_API_URL } from "../url";
import { BMapError } from "../../errors/BMapError";
import { BaiduJsapiV4Provider, baiduJsapiV4Provider } from "./BaiduJsapiV4Provider";
import { existingGlobalV4Provider } from "./ExistingGlobalV4Provider";
import { CustomScriptV4Provider, customScriptV4Provider } from "./CustomScriptV4Provider";

const COMPLETE_NAMESPACE = { Map: () => {}, Point: () => {}, Marker: () => {} };
const AK = "ak-abcdef123456";

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
  return { load, loader: { load } as unknown as ScriptLoader };
}

function newDomain(): SdkRegistry {
  return new SdkRegistry({ domain: "BMap" });
}

afterEach(() => {
  delete (globalThis as { BMap?: unknown }).BMap;
  delete (document as unknown as Record<string, unknown>).body;
  resetGlobalCallbackRegistryForTests();
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
      loader: { load } as unknown as ScriptLoader,
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

  it("getCacheKey 与冲突域使用同一指纹", async () => {
    const fake = createFakeLoader(() => installGlobal(COMPLETE_NAMESPACE));
    const provider = new BaiduJsapiV4Provider({ loader: fake.loader, registry: newDomain() });
    const options = { ak: AK };

    const loaded = await provider.load(options);
    expect(provider.getCacheKey(options)).toBe(loaded.load.fingerprint);
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
    expect(loaded.load.apiUrl).toBe(new URL("./bmap-v4.js", document.baseURI).toString());
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

  it("空 scriptSrc 直接拒绝", () => {
    expect(() => customScriptV4Provider("")).toThrow(BMapError);
    expect(() => customScriptV4Provider("")).toThrow(/non-empty scriptSrc/);
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
