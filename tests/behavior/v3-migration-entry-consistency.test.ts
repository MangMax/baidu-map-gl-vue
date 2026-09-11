/**
 * 迁移期 definition 归一的一致性（评审 P2 回归）
 *
 * 同一份符合新契约的结构化 legacy definition（`{ engine: "webgl-v1", namespace }`，
 * 未显式声明 `driver`），在**任意入口**都必须进入 legacy Driver；不应因为「放在组件
 * prop / 插件 client / app 默认定义 / 地图外 context」而报
 * `BMAP_SDK_ENGINE_MISMATCH`。
 *
 * 修复前为红的三条路径：`<BMap :definition>`、插件 `client` → `<BMapProvider>`、
 * 插件 `client` → `resolveMapContext`。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BMapProvider from "../../packages/baidu-map-gl-vue/src/components/provider/BMapProvider.vue";
import { createBMapPlugin } from "../../packages/baidu-map-gl-vue/src/plugins/createBMapPlugin";
import { jsapiV4DriverFactory } from "../../packages/baidu-map-gl-vue/src/client/createBMapClient";
import { resolveMapContext } from "../../packages/baidu-map-gl-vue/src/composables/resolveMapContext";
import { getFakeBMapGl, resetLifecycleState } from "../../packages/test-utils";
import type { BMapClient } from "../../packages/baidu-map-gl-vue/src/client/types";
import type { LoadedSdk } from "../../packages/baidu-map-gl-vue/src/core/loader/loaded";
import { BMapError } from "../../packages/baidu-map-gl-vue/src/core/errors/BMapError";

const fake = getFakeBMapGl();

/** 符合新契约的结构化 legacy Provider（不返回裸 SDK，也不带 driver）。 */
function structuredLegacyProvider() {
  return {
    id: "review-legacy",
    getCacheKey: () => "review-legacy",
    load: async (): Promise<LoadedSdk> => ({ engine: "webgl-v1", namespace: fake }),
  };
}

/** 同一份 definition：各入口共用，避免「各写一份」掩盖差异。 */
function sharedDefinition() {
  return { provider: structuredLegacyProvider(), loadOptions: {} };
}

function host() {
  const el = document.createElement("div");
  el.style.width = "200px";
  el.style.height = "200px";
  document.body.appendChild(el);
  return el;
}

function expectLegacyClient(client: BMapClient | null | undefined, entry: string) {
  expect(client, `${entry} 未产出 client`).toBeTruthy();
  expect(client!.engine, `${entry} 未进入 legacy Driver`).toBe("webgl-v1");
  // fake SDK 不暴露 VERSION，此时 detectVersion 回退为 "webgl-v1"（版本由 Driver 探测）
  expect(typeof client!.sdkVersion).toBe("string");
}

beforeEach(() => {
  resetLifecycleState();
});

describe("迁移期 definition 在不同入口的一致性", () => {
  it("<BMap :definition> 与 <BMapProvider :definition> 行为一致", async () => {
    const providerWrapper = mount(BMapProvider, {
      props: { definition: sharedDefinition() },
      slots: { default: () => h("div") },
    });
    await flushPromises();
    expectLegacyClient(
      (providerWrapper.emitted("ready") as [BMapClient][])?.[0]?.[0],
      "<BMapProvider :definition>",
    );
    providerWrapper.unmount();

    const mapWrapper = mount(BMap, {
      attachTo: host(),
      props: { definition: sharedDefinition() },
    });
    await flushPromises();
    const errorCodes = (mapWrapper.emitted("error") as [unknown][] | undefined)?.map(
      (e) => (e[0] as BMapError)?.code,
    );
    expect(errorCodes ?? [], "<BMap :definition> 不应因缺少 driver 报错").not.toContain(
      "BMAP_SDK_ENGINE_MISMATCH",
    );
    expect(errorCodes ?? []).not.toContain("BMAP_CAPABILITY_UNSUPPORTED");
    const ready = mapWrapper.emitted("ready") as [{ client: BMapClient }][] | undefined;
    if (ready?.length) {
      expectLegacyClient(ready[0]?.[0]?.client, "<BMap :definition>");
    }
    mapWrapper.unmount();
  });

  it("插件 client → <BMapProvider>（app 默认 definition）进入 legacy Driver", async () => {
    const wrapper = mount(BMapProvider, {
      slots: { default: () => h("div") },
      global: { plugins: [createBMapPlugin({ client: sharedDefinition() })] },
    });
    await flushPromises();
    expectLegacyClient(
      (wrapper.emitted("ready") as [BMapClient][])?.[0]?.[0],
      "插件 client → <BMapProvider>",
    );
    wrapper.unmount();
  });

  it("插件 client → resolveMapContext（地图外服务）进入 legacy Driver", async () => {
    let context: ReturnType<typeof resolveMapContext> | undefined;
    const Probe = defineComponent({
      setup() {
        context = resolveMapContext();
        return () => h("div");
      },
    });
    const wrapper = mount(Probe, {
      global: { plugins: [createBMapPlugin({ client: sharedDefinition() })] },
    });

    let client: BMapClient | null = null;
    let failure: unknown = null;
    try {
      const ready = await context!.whenReady();
      client = ready.client;
    } catch (e) {
      failure = e;
    }
    await flushPromises();

    expect(failure, `resolveMapContext 不应失败：${(failure as Error)?.message}`).toBeNull();
    expectLegacyClient(client, "插件 client → resolveMapContext");
    wrapper.unmount();
  });

  it("显式 driver 优先：迁移归一不会覆盖调用方注入的 Driver 工厂", async () => {
    const wrapper = mount(BMapProvider, {
      props: {
        definition: {
          provider: structuredLegacyProvider(),
          loadOptions: {},
          // 显式注入 v4 工厂：它只接受 jsapi-v4，因此 legacy 加载结果必须在这里失败。
          // 若迁移归一覆盖了显式 driver，这条路会「成功」——测试就会失败。
          driver: jsapiV4DriverFactory,
        },
      },
      slots: { default: () => h("div") },
    });
    await flushPromises();

    expect(wrapper.emitted("ready")).toBeUndefined();
    const codes = ((wrapper.emitted("error") as [BMapError][]) ?? []).map((e) => e[0]?.code);
    expect(codes).toContain("BMAP_SDK_ENGINE_MISMATCH");
    wrapper.unmount();
  });
});
