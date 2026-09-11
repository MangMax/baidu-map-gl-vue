/**
 * useOverlayResource：重建进行中的更新不能被丢弃（PR #61 评审 P2-1）
 *
 * 评审反例：`applyOptions({ enableClicking: false })` 触发 rebuild（create 异步、`resource` 期间为
 * `null`），创建尚未完成时又改回 `true`/改别的 mutable 键 —— 第二次 `applyOptions` 因为
 * `!current` 直接返回，最终挂载的实例与最新 props 不一致（既没有记录待应用的值，也没有淘汰
 * 正在创建的旧版本）。
 *
 * 这里用**可控 Promise** 的 `create` 精确卡住那个窗口，而不是靠 `flushPromises()` 撞运气。
 */
import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, provide, reactive } from "vue";
import { mapContextKey, type MapContext } from "../context/types";
import { useOverlayResource, type OverlayLifecycle, type UseOverlayResourceResult } from "./useOverlayResource";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Instance {
  id: number;
}

function setupHarness() {
  const pendingCreates: Array<{ resolve: (value: Instance) => void; props: Record<string, unknown> }> = [];
  const setOptionsCalls: Array<{ instance: Instance; options: Record<string, unknown> }> = [];

  const overlaysApi = {
    // 只把 enableClicking 当构造期属性，其余当 mutable
    updatePolicy: (_handle: unknown, key: string) =>
      key === "enableClicking" ? "recreate" : "mutable",
    setOptions: (handle: Instance, options: Record<string, unknown>) => {
      setOptionsCalls.push({ instance: handle, options });
    },
  };

  const lifecycle: OverlayLifecycle<Record<string, unknown>, Instance> = {
    // 返回**可控 Promise**：测试自己决定创建何时完成，从而精确卡住「重建进行中」的窗口
    create: (_ctx, props) => {
      const d = deferred<Instance>();
      pendingCreates.push({ resolve: d.resolve, props: props as Record<string, unknown> });
      return d.promise;
    },
    addToMap: () => {},
    remove: () => {},
  };

  const readyCtx = {
    client: { driver: { overlays: overlaysApi } },
    map: { raw: {} },
  };
  const mapCtx = {
    whenReady: async () => readyCtx,
    events: { emit: vi.fn() },
  } as unknown as MapContext;

  const props = reactive<Record<string, unknown>>({ enableClicking: true, title: "initial" });
  let result!: UseOverlayResourceResult<Instance>;
  // provide 对**后代**可见，所以必须由父组件 provide、子组件里调用 composable
  const Consumer = defineComponent({
    setup() {
      result = useOverlayResource<Record<string, unknown>, Instance>(props, lifecycle);
      return () => h("div");
    },
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        provide(mapContextKey, mapCtx);
        return () => h(Consumer);
      },
    }),
  );

  return { result, props, pendingCreates, setOptionsCalls, wrapper };
}

/** 挂载并完成第一次创建（首次 create 也走可控 Promise） */
async function mountWithFirstInstance(harness: ReturnType<typeof setupHarness>) {
  await flushPromises();
  harness.pendingCreates[0].resolve({ id: 1 });
  await flushPromises();
}

describe("useOverlayResource.applyOptions 与进行中的 rebuild", () => {
  it("重建期间到达的更新不会被丢弃：最终实例仍应用最新 props", async () => {
    const harness = setupHarness();
    await mountWithFirstInstance(harness);

    // 1) recreate 键 → 触发 rebuild；create 被卡住（未 resolve）
    const rebuildDone = harness.result.applyOptions({ enableClicking: false });
    await flushPromises();
    expect(harness.result.resource.value).toBeNull();

    // 2) 创建尚未完成时又收到一条 mutable 更新（评审反例：窗口内的第二次更新）
    harness.props.title = "late";
    await harness.result.applyOptions({ title: "late" });

    // 3) 放行创建
    harness.pendingCreates[1].resolve({ id: 2 });
    await rebuildDone;
    await flushPromises();

    const mounted = harness.result.resource.value;
    expect(mounted).not.toBeNull();
    // 最终挂载的实例必须收到窗口内那条更新，否则它就与最新 props 不一致
    expect(harness.setOptionsCalls).toContainEqual({
      instance: { id: 2 },
      options: { title: "late" },
    });

    harness.wrapper.unmount();
    await flushPromises();
  });

  it("重建期间的多条更新会合并，且在重建完成后只应用一次", async () => {
    const harness = setupHarness();
    await mountWithFirstInstance(harness);

    const rebuildDone = harness.result.applyOptions({ enableClicking: false });
    await flushPromises();

    await harness.result.applyOptions({ title: "a" });
    await harness.result.applyOptions({ zIndex: 9 });

    harness.pendingCreates[1].resolve({ id: 2 });
    await rebuildDone;
    await flushPromises();

    const forNewInstance = harness.setOptionsCalls.filter((c) => c.instance.id === 2);
    expect(forNewInstance).toHaveLength(1);
    expect(forNewInstance[0].options).toEqual({ title: "a", zIndex: 9 });

    harness.wrapper.unmount();
    await flushPromises();
  });

  it("重建期间到达的 recreate 更新会在重建完成后补一次重建", async () => {
    const harness = setupHarness();
    await mountWithFirstInstance(harness);

    const rebuildDone = harness.result.applyOptions({ enableClicking: false });
    await flushPromises();

    // 窗口内又是一次构造期属性变化：必须再重建一次，否则最终实例仍是旧构造选项
    await harness.result.applyOptions({ enableClicking: true });

    // 放行第一次重建 → 它挂载后补跑待办 → 待办是 recreate → 触发第二次 rebuild（不再 await 前者）
    harness.pendingCreates[1].resolve({ id: 2 });
    await flushPromises();
    await flushPromises();
    expect(harness.pendingCreates).toHaveLength(3);

    harness.pendingCreates[2].resolve({ id: 3 });
    await flushPromises();
    await rebuildDone;
    await flushPromises();

    expect(harness.result.resource.value).toEqual({ id: 3 });

    harness.wrapper.unmount();
    await flushPromises();
  });

  it("卸载后到达的更新不排队、不创建", async () => {
    const harness = setupHarness();
    await mountWithFirstInstance(harness);
    harness.wrapper.unmount();
    await flushPromises();

    const before = harness.pendingCreates.length;
    await harness.result.applyOptions({ title: "after-unmount" });
    expect(harness.pendingCreates).toHaveLength(before);
    expect(harness.setOptionsCalls).toEqual([]);
  });
});
