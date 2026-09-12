/**
 * 默认入口的 JSAPI 4.0 切换（M3A3-CUTOVER / issue #25）
 *
 * 这一层只回答一个容易被搞错的问题：**不显式传 provider** 时，组件/插件到底走哪条路径。
 * 三件事必须被钉住：
 *
 * 1. 默认 Provider 是 v4 CDN 家族（`baidu-jsapi-v4`），不是迁移期 `baiduCdnProvider()`；
 * 2. 默认入口在 `globalThis.BMap` 已就绪时，产出的是 `jsapi-v4` Client，且 `rawSdk` **就是**
 *    那个全局命名空间——即「读取 globalThis.BMap」而不是另插一个 script；
 * 3. 「存量全局」回退只认 `BMap`（结构完整），只有 `BMapGL` 的页面不再被默认路径接管。
 *
 * 显式传 `provider` 的路径仍按加载结果分派（迁移期行为，随 #26 收敛），不在本文件断言范围内。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import { createBMapPlugin } from "../../packages/baidu-map-gl-vue/src/plugins/createBMapPlugin";
import { hasExistingJsapiV4Global } from "../../packages/baidu-map-gl-vue/src/core/loader/providers";
import { hasExistingGlobalSdk } from "../../packages/baidu-map-gl-vue/src/core/loader/Provider";
import { DEFAULT_VERSION } from "../../packages/baidu-map-gl-vue/src/core/loader/url";
import { ScriptLoader } from "../../packages/baidu-map-gl-vue/src/core/loader/ScriptLoader";
import { createFakeBMapV4, resetLifecycleState } from "../../packages/test-utils";
import type { BMapClient } from "../../packages/baidu-map-gl-vue/src/client/types";

const globalScope = globalThis as { BMap?: unknown; BMapGL?: unknown };
const savedBMap = globalScope.BMap;
const savedBMapGl = globalScope.BMapGL;

function host(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "200px";
  el.style.height = "200px";
  document.body.appendChild(el);
  return el;
}

function providerIdOf(provider: unknown): string | undefined {
  return (provider as { id?: string } | undefined)?.id;
}

beforeEach(() => {
  resetLifecycleState();
});

afterEach(() => {
  // 恢复成文件加载时的原样：`tests/setup.ts` 会注入 legacy Fake 的 `BMapGL`，别把它带走
  if (savedBMap === undefined) delete globalScope.BMap;
  else globalScope.BMap = savedBMap;
  if (savedBMapGl === undefined) delete globalScope.BMapGL;
  else globalScope.BMapGL = savedBMapGl;
});

describe("默认入口的 v4 切换", () => {
  it("默认 Provider 是 JSAPI 4.0 CDN 家族，默认版本是 4.0", () => {
    const plugin = createBMapPlugin({ ak: "test-ak" });
    expect(providerIdOf(plugin.config.provider)).toBe("baidu-jsapi-v4");
    expect(plugin.config.defaults.version).toBe(DEFAULT_VERSION);
    expect(plugin.config.defaults.version).toBe("4.0");
  });

  it("allowExistingGlobal 指向 v4 的存量全局 Provider（不再探测 BMapGL）", () => {
    const plugin = createBMapPlugin({ allowExistingGlobal: true });
    expect(providerIdOf(plugin.config.provider)).toBe("existing-global-v4");
  });

  it("默认入口在 globalThis.BMap 就绪时产出 jsapi-v4 Client，且不发起 SDK 加载", async () => {
    const fake = createFakeBMapV4();
    globalScope.BMap = fake.namespace;

    // 复用路径**不应该**碰 ScriptLoader：一旦被调用就会有 script / JSONP 请求
    const loadSpy = vi.spyOn(ScriptLoader.prototype, "load");

    const wrapper = mount(BMap, {
      attachTo: host(),
      global: { plugins: [createBMapPlugin({ ak: "test-ak" })] },
    });
    await flushPromises();
    await flushPromises();

    const ready = (wrapper.emitted("ready") as [{ client: BMapClient }][] | undefined)?.[0]?.[0];
    expect(ready, "<BMap> 未 ready").toBeTruthy();
    expect(ready!.client.engine).toBe("jsapi-v4");
    // 默认入口读的就是这个命名空间对象本身
    expect(ready!.client.rawSdk).toBe(fake.namespace);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(document.querySelectorAll('script[src*="api.map.baidu.com"]')).toHaveLength(0);
    // 没有 error 事件（修前这里会是 BMAP_SDK_CALL_FAILED 之类）
    expect(wrapper.emitted("error")).toBeUndefined();

    wrapper.unmount();
  });

  it("存量全局探测只认结构完整的 BMap，看到 BMapGL 不算 v4 就绪", () => {
    globalScope.BMap = undefined;
    globalScope.BMapGL = createFakeBMapV4().namespace;

    // 默认（v4）回退不接管……
    expect(hasExistingJsapiV4Global()).toBe(false);
    // ……但迁移期 legacy 的宽松探测仍然成立（显式 legacy 路径用，随 #26 删除）
    expect(hasExistingGlobalSdk()).toBe(true);

    // 缺成员的 BMap 也不算就绪：不降级使用残缺命名空间
    globalScope.BMap = { Map: class {} };
    expect(hasExistingJsapiV4Global()).toBe(false);
  });
});
