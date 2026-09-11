/**
 * 覆盖物属性更新策略的组件级验证（M3A2-OVERLAYS / issue #21）
 *
 * issue #21 的测试要求里有三条只能在**组件/组合式层**观察：
 * - mutable 属性不重建、recreate 属性只重建一次；
 * - 旧实例的 child scope 在重建后资源归零；
 * - Target 切换先从旧目标移除再挂新目标。
 *
 * 这三条经 `useOverlayResource.applyOptions`（分类来自 Driver 的 `updatePolicy`）落地，
 * 组件侧因此不再自行探测 raw SDK 成员形状（BMarker 原先会读 `raw.setIcon`）。
 * 组件路径目前经 legacy（webgl-v1）Client 装配 —— 默认 v4 装配属 #23/#25。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import BMap from "../../packages/baidu-map-gl-vue/src/components/map/BMap.vue";
import BMarker from "../../packages/baidu-map-gl-vue/src/components/overlays/BMarker.vue";
import BContextMenu from "../../packages/baidu-map-gl-vue/src/components/overlays/BContextMenu.vue";
import { getFakeBMapGl, resetLifecycleState } from "../../packages/test-utils";

const fake = getFakeBMapGl();

function provider() {
  return {
    load: async () => {
      (window as unknown as Record<string, unknown>).BMapGL = fake;
      return fake;
    },
  };
}

function host(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "200px";
  el.style.height = "200px";
  document.body.appendChild(el);
  return el;
}

type FakeOverlay = {
  callLog: string[];
  getListenerCount(): number;
  position?: { lng: number; lat: number };
};

/** 当前地图上挂着的覆盖物（BMarker 重建后是新实例）。 */
function currentMarker(): FakeOverlay {
  const map = fake.createdMaps[fake.createdMaps.length - 1] as unknown as {
    overlays: Set<FakeOverlay>;
  };
  return [...map.overlays][0];
}

beforeEach(() => resetLifecycleState());

describe("mutable 属性就地更新（不重建）", () => {
  it("icon 变化走 setIcon，marker 实例与挂载次数都不变", async () => {
    fake.stats.reset();
    const el = host();
    const icon = ref<unknown>({
      imageUrl: "https://example.com/a.png",
      size: { width: 10, height: 10 },
    });
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [
              h(BMarker, { position: { lng: 116.4, lat: 39.9 }, icon: icon.value }),
            ]);
        },
      }),
      { attachTo: el },
    );
    await flushPromises();

    const before = currentMarker();
    const created = fake.stats.overlaysCreated;

    icon.value = { imageUrl: "https://example.com/b.png", size: { width: 12, height: 12 } };
    await nextTick();
    await flushPromises();

    // 实例没换、也没有再次 addOverlay，但 SDK 侧的 setIcon 被调用过
    expect(currentMarker()).toBe(before);
    expect(before.callLog).toContain("setIcon");
    expect(fake.stats.overlaysCreated).toBe(created);

    wrapper.unmount();
    await nextTick();
  });
});

describe("recreate 属性只重建一次", () => {
  it("enableClicking 变化触发一次重建，且旧实例的 child scope 资源归零", async () => {
    fake.stats.reset();
    const el = host();
    const enableClicking = ref(true);
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [
              h(BMarker, {
                position: { lng: 116.4, lat: 39.9 },
                enableClicking: enableClicking.value,
              }),
            ]);
        },
      }),
      { attachTo: el },
    );
    await flushPromises();

    const oldMarker = currentMarker();
    const listenersBaseline = fake.stats.listeners;
    const created = fake.stats.overlaysCreated;
    expect(oldMarker.getListenerCount()).toBeGreaterThan(0);

    enableClicking.value = false;
    await nextTick();
    await flushPromises();

    const newMarker = currentMarker();
    // 只重建一次：一个新实例替换旧实例（挂载 +1、摘除 +1，没有多余的来回）
    expect(newMarker).not.toBe(oldMarker);
    expect(fake.stats.overlaysCreated).toBe(created + 1);
    expect((fake.createdMaps[fake.createdMaps.length - 1] as unknown as { overlays: Set<FakeOverlay> }).overlays.size).toBe(1);

    // 旧实例的监听全部释放（child scope 归零），当前监听数回到单实例基线
    expect(oldMarker.getListenerCount()).toBe(0);
    expect(fake.stats.listeners).toBe(listenersBaseline);

    wrapper.unmount();
    await nextTick();
    expect(fake.stats.listeners).toBe(0);
  });
});

describe("Target 切换先从旧目标移除再挂新目标", () => {
  it("父 Marker 重建后，旧实例摘菜单、新实例挂菜单，且不留下双挂载", async () => {
    fake.stats.reset();
    const el = host();
    const enableClicking = ref(true);
    const wrapper = mount(
      defineComponent({
        components: { BMap, BMarker, BContextMenu },
        setup() {
          return () =>
            h(BMap, { provider: provider() }, () => [
              h(BMarker, { position: { lng: 116.4, lat: 39.9 }, enableClicking: enableClicking.value }, () => [
                h(BContextMenu, { width: 120, menuItems: [{ text: "a", callback: () => {} }] }),
              ]),
            ]);
        },
      }),
      { attachTo: el },
    );
    await flushPromises();
    await flushPromises();

    const oldMarker = currentMarker();
    expect(oldMarker.callLog).toContain("addContextMenu");

    enableClicking.value = false;
    await nextTick();
    await flushPromises();
    await flushPromises();

    const newMarker = currentMarker();
    expect(newMarker).not.toBe(oldMarker);
    // 先摘（旧目标）后挂（新目标）：旧实例留下 removeContextMenu，新实例留下 addContextMenu
    expect(oldMarker.callLog).toContain("removeContextMenu");
    expect(newMarker.callLog).toContain("addContextMenu");

    wrapper.unmount();
    await nextTick();
  });
});
