/**
 * Control / Layer 资源卸载顺序（M3A2-CONTROLS-LAYERS / issue #22 实施步骤 4）
 *
 * 「确保 remove 先解绑业务事件，再由 Map 移除资源」是 issue 的实施要求，而它落在
 * `useControlResource` / `useLayerResource` 的 `onUnmounted` 上（组件的业务监听器都经
 * `scope.add(...)` 注册——`BLocation` 的 locationSuccess/locationError、
 * `BDistrictLayer` 的 click/mouseover/mouseout）。
 *
 * 这条顺序无法从组件级测试的外部行为观察，因此这里用一个**最小 MapContext 替身** +
 * 记账适配器把顺序变成可断言的事实：卸载时必须是 `unbind → sdk-remove`，
 * 否则 SDK 在 `removeControl` / `removeLayer` 期间同步派发的事件会打到正在拆解的业务回调上。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, provide } from "vue";
import type { MapReadyContext } from "../context/types";
import { mapContextInjectionKey } from "../context/inject";
import { ResourceScope } from "../lifecycle/ResourceScope";
import { useControlResource } from "./useControlResource";
import { useLayerResource } from "./useLayerResource";

/** 卸载过程中记录到的动作顺序。 */
let order: string[] = [];

/**
 * 最小 MapContext 替身：只满足这两个 composable 真正用到的成员
 * （`whenReady` 与 `events.emit`），其余按类型断言补齐——测的是卸载顺序，不是 context。
 */
function fakeMapContext(): never {
  const ready: MapReadyContext = {
    client: {} as MapReadyContext["client"],
    map: { raw: {} } as MapReadyContext["map"],
  };
  return {
    whenReady: async () => ready,
    events: { emit: () => {} },
  } as never;
}

beforeEach(() => {
  order = [];
});

const ADAPTER_STEPS = {
  create: (_ctx: unknown, _props: unknown, scope: ResourceScope) => {
    // 业务事件/副作用：与组件里 `scope.add(events.on(res, ...))` 同形
    scope.add(() => order.push("unbind"));
    return { id: "resource" };
  },
  remove: () => {
    order.push("sdk-remove");
  },
};

function mountWith(use: "control" | "layer") {
  const Child = defineComponent({
    name: use === "control" ? "ProbeControl" : "ProbeLayer",
    setup() {
      if (use === "control") {
        useControlResource({} as Record<string, never>, {
          create: ADAPTER_STEPS.create,
          addToMap: () => order.push("add-to-map"),
          remove: ADAPTER_STEPS.remove,
        });
      } else {
        useLayerResource({} as Record<string, never>, {
          create: ADAPTER_STEPS.create,
          addToMap: () => order.push("add-to-map"),
          remove: ADAPTER_STEPS.remove,
        });
      }
      return () => null;
    },
  });

  return mount(
    defineComponent({
      setup() {
        provide(mapContextInjectionKey, fakeMapContext());
        return () => h(Child);
      },
    }),
  );
}

describe.each([
  ["useControlResource", "control"],
  ["useLayerResource", "layer"],
] as const)("%s 的卸载顺序", (_name, composable) => {
  it("先解绑业务事件，再由 Map 移除资源", async () => {
    const wrapper = mountWith(composable);
    await flushPromises();
    expect(order).toEqual(["add-to-map"]);

    wrapper.unmount();
    await flushPromises();

    expect(order).toEqual(["add-to-map", "unbind", "sdk-remove"]);
  });
});
