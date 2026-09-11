/**
 * M3A1-CLIENT（#18）：<BMapProvider> 的 loading / error / retry slot 行为
 *
 * Client Context 的结构化 load/retry/status/error 必须真实驱动插槽：
 * - loading：load 未结算时显示 loading slot；
 * - ready：结算后显示默认插槽并 emit ready；
 * - error：失败时显示 error slot（带 error + retry）并 emit error；
 * - retry：从 error 恢复为 ready，且不残留上一轮错误。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { h, nextTick } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import BMapProvider from "../../packages/baidu-map-gl-vue/src/components/provider/BMapProvider.vue";
import { withMigrationDriver } from "../../packages/baidu-map-gl-vue/src/client/migration";
import type { BMapLoadOptions } from "../../packages/baidu-map-gl-vue/src/core/loader/url";
import type { BMapClient } from "../../packages/baidu-map-gl-vue/src/client/types";
import type { LoadedSdk } from "../../packages/baidu-map-gl-vue/src/core/loader/loaded";
import { BMapError } from "../../packages/baidu-map-gl-vue/src/core/errors/BMapError";

const legacyNamespace = { Map: class {}, Point: class {}, Marker: class {}, VERSION: "1.0" };

function definitionFor(load: (options: BMapLoadOptions) => Promise<unknown>) {
  return withMigrationDriver({
    provider: { id: "test-legacy", getCacheKey: () => "fp", load },
    loadOptions: { ak: "test" },
  });
}

let seenRetry: (() => Promise<void>) | undefined;
let seenError: BMapError | undefined;

function slots() {
  return {
    default: () => h("div", { "data-test": "child" }, "child"),
    loading: () => h("div", { "data-test": "loading" }, "loading"),
    error: (slotProps: { error: BMapError; retry: () => Promise<void> }) => {
      seenError = slotProps.error;
      seenRetry = slotProps.retry;
      return h("div", { "data-test": "error" }, slotProps.error.code);
    },
  };
}

beforeEach(() => {
  seenRetry = undefined;
  seenError = undefined;
});

describe("<BMapProvider> 状态插槽", () => {
  it("loading → ready：loading 插槽出现，默认插槽常驻并 emit ready", async () => {
    let resolveLoad!: (value: LoadedSdk) => void;
    const load = vi.fn(
      () =>
        new Promise<LoadedSdk>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const wrapper = mount(BMapProvider, {
      props: { definition: definitionFor(load) },
      slots: slots(),
    });

    // mounted 之后才发起加载：先渲染 idle，再进入 loading
    await nextTick();
    expect(wrapper.find('[data-test="loading"]').exists()).toBe(true);
    // 文档约定：默认插槽常驻（加载中也渲染），加载状态以插槽叠加形式暴露
    expect(wrapper.find('[data-test="child"]').exists()).toBe(true);

    resolveLoad({ engine: "webgl-v1", namespace: legacyNamespace });
    await flushPromises();

    expect(wrapper.find('[data-test="loading"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="child"]').exists()).toBe(true);

    const ready = wrapper.emitted("ready") as [BMapClient][] | undefined;
    expect(ready).toHaveLength(1);
    expect(ready![0]![0].engine).toBe("webgl-v1");

    wrapper.unmount();
  });

  it("load 失败 → error 插槽带 error/retry，retry 恢复为 ready", async () => {
    let attempts = 0;
    const load = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("boom");
      return legacyNamespace;
    });
    const wrapper = mount(BMapProvider, {
      props: { definition: definitionFor(load) },
      slots: slots(),
    });
    await flushPromises();

    expect(wrapper.find('[data-test="error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="child"]').exists()).toBe(true);
    expect(seenError?.code).toBe("BMAP_SDK_LOAD_FAILED");
    expect(typeof seenRetry).toBe("function");
    const failed = wrapper.emitted("error") as [BMapError][] | undefined;
    expect(failed).toHaveLength(1);

    await seenRetry!();
    await flushPromises();

    expect(attempts).toBe(2);
    expect(wrapper.find('[data-test="error"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="child"]').exists()).toBe(true);
    expect((wrapper.emitted("ready") as unknown[]).length).toBe(1);

    wrapper.unmount();
  });

  it("provider prop 走显式 legacy 工厂（迁移期默认路径）", async () => {
    const wrapper = mount(BMapProvider, {
      props: {
        provider: { id: "test-legacy", load: async () => legacyNamespace },
        loadOptions: {},
      },
      slots: slots(),
    });
    await flushPromises();

    expect(wrapper.find('[data-test="child"]').exists()).toBe(true);
    const ready = wrapper.emitted("ready") as [BMapClient][] | undefined;
    expect(ready?.[0]?.[0].engine).toBe("webgl-v1");

    wrapper.unmount();
  });
});
