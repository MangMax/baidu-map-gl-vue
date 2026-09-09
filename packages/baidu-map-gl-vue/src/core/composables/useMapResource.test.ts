/**
 * useMapResource 竞态测试
 *
 * 验证核心不变式:"组件在 SDK 就绪前卸载,不创建 SDK 资源"。
 */
import { describe, it, expect, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import { useMapResource, type SdkResourceAdapter } from "./useMapResource";
import { MapRuntime } from "../runtime/MapRuntime";

interface Props {
  value: number;
  __componentName?: string;
}

function createDeferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeRuntime() {
  const deferred = createDeferred<any>();
  const fakeClient = {
    driver: {
      map: {
        create: () => ({ id: "map" }),
        destroy: () => {},
        initializeView: () => {},
      },
    },
  };
  const rt = new MapRuntime({
    clientFactory: () => deferred.promise.then(() => fakeClient) as never,
    container: document.createElement("div"),
  });
  return { rt, deferred };
}

function makeAdapter() {
  const create = vi.fn();
  const destroy = vi.fn();
  const adapter: SdkResourceAdapter<Props, { id: string }> = {
    create: (...args) => {
      create(...args);
      return { id: "res" };
    },
    destroy,
  };
  return { adapter, create, destroy };
}

describe("useMapResource", () => {
  it("creates resource after sdk ready", async () => {
    const { rt, deferred } = makeRuntime();
    const { adapter, create } = makeAdapter();
    const props: Props = { value: 1 };
    const Comp = defineComponent({
      setup() {
        return { result: useMapResource(rt, props, adapter) };
      },
      render: () => h("div"),
    });
    const wrapper = mount(Comp);
    rt.mount();
    deferred.resolve({ api: "x" });
    await flushPromises();
    expect(create).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    rt.dispose();
  });

  it("does not create resource when unmounted before sdk ready", async () => {
    const { rt, deferred } = makeRuntime();
    const { adapter, create, destroy } = makeAdapter();
    const props: Props = { value: 1 };
    const Comp = defineComponent({
      setup() {
        return { result: useMapResource(rt, props, adapter) };
      },
      render: () => h("div"),
    });
    const wrapper = mount(Comp);
    void rt.mount().catch(() => {}); // dispose 后 mount 会拒绝(预期)
    wrapper.unmount(); // SDK 尚未 resolve,组件先卸载
    deferred.resolve({ api: "x" });
    await nextTick();
    expect(create).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    rt.dispose();
  });

  it("creates then destroys if unmount races after create", async () => {
    const { rt, deferred } = makeRuntime();
    const { adapter, create, destroy } = makeAdapter();
    const props: Props = { value: 1 };
    const Comp = defineComponent({
      setup() {
        return { result: useMapResource(rt, props, adapter) };
      },
      render: () => h("div"),
    });
    const wrapper = mount(Comp);
    rt.mount();
    deferred.resolve({ api: "x" });
    await flushPromises();
    expect(create).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    rt.dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("emits resource:error on create failure", async () => {
    const { rt, deferred } = makeRuntime();
    const create = vi.fn(() => {
      throw new Error("create fail");
    });
    const adapter: SdkResourceAdapter<Props, unknown> = { create, destroy: vi.fn() };
    const onError = vi.fn();
    rt.events.on("resource:error", onError);
    const props: Props = { value: 1 };
    const Comp = defineComponent({
      setup() {
        return { result: useMapResource(rt, props, adapter) };
      },
      render: () => h("div"),
    });
    mount(Comp);
    rt.mount();
    deferred.resolve({ api: "x" });
    await flushPromises();
    expect(onError).toHaveBeenCalledTimes(1);
    rt.dispose();
  });
});
