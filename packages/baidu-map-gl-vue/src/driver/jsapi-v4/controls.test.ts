/**
 * v4 ControlDriver（M3A2-CONTROLS-LAYERS / issue #22）
 *
 * 验收点（对应 issue #22 的「测试要求」与「验收标准」）：
 * - issue 目标与范围列出的每个控件都有 create / add / remove / show / hide 测试；
 * - anchor / offset 归一化：官方常量名 → 4.0 数值、Pixel → `Size`；非四角落点与未知常量
 *   都要**可见**（告警一次），不静默；
 * - `setOptions` 的动态 / 构造期分类：动态项走字段级 setter 或成对动作，构造期项告警且不动；
 * - Target：Map 目标原子加/摘（重复 add 不重复挂载、remove 后可重挂），非 Map 目标显式失败；
 * - 本引擎没有运行时入口的成员（`PanoramaControl` 缺基类成员、缺构造器）显式告警 / 失败。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../../../test-utils";
import { HANDLE_BRAND, type ControlHandle } from "../types/handles";
import { createJsapiV4ControlDriver } from "./controls";
import { createJsapiV4GeometryDriver } from "./geometry";
import { createJsapiV4HandleRegistry } from "./registry";

/** issue #22「目标与范围」列出的十个内置控件 + 自定义控件（kind → 官方构造器名）。 */
const CONTROL_KINDS = [
  ["zoom", "ZoomControl"],
  ["scale", "ScaleControl"],
  ["navigation", "NavigationControl"],
  ["navigation-3d", "NavigationControl3D"],
  ["city-list", "CityListControl"],
  ["location", "GeolocationControl"],
  ["map-type", "MapTypeControl"],
  ["overview", "OverviewMapControl"],
  ["panorama", "PanoramaControl"],
  ["copyright", "CopyrightControl"],
] as const;

function setup(rawSdk?: unknown) {
  const fake: FakeBMapV4 = createFakeBMapV4();
  const registry = createJsapiV4HandleRegistry();
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  const controls = createJsapiV4ControlDriver({
    rawSdk: rawSdk ?? fake.namespace,
    geometry,
    registry,
  });
  const container = document.createElement("div");
  container.style.width = "400px";
  container.style.height = "300px";
  document.body.appendChild(container);
  const rawMap = new fake.namespace.Map(container);
  const map = registry.adopt("map", rawMap);

  const rawOf = (handle: ControlHandle) => handle.raw as Record<string, unknown>;
  const mapTarget = () => ({ kind: "map" as const, handle: map });

  return { fake, registry, geometry, controls, container, rawMap, map, rawOf, mapTarget };
}

let ctx: ReturnType<typeof setup>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ctx = setup();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

/* -------------------------------------------------------------------------- */
/* 1. create：十个内置控件的构造器映射与选项归一化                                */
/* -------------------------------------------------------------------------- */

describe("内置控件的创建与构造参数映射", () => {
  it.each(CONTROL_KINDS)("%s → BMap.%s", (kind, ctorName) => {
    const handle = ctx.controls.create(kind);
    const raw = ctx.rawOf(handle);

    expect(handle.raw).toBeInstanceOf(
      (ctx.fake.namespace as unknown as Record<string, unknown>)[ctorName],
    );
    expect(raw).toBeTruthy();
  });

  it("anchor 常量名换算为 4.0 数值，offset 换算为 Size", () => {
    const handle = ctx.controls.create("zoom", {
      anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
      offset: { x: 83, y: 18 },
    });
    const raw = ctx.rawOf(handle);

    // 官方四角常量：TOP_LEFT 0 / TOP_RIGHT 1 / BOTTOM_LEFT 2 / BOTTOM_RIGHT 3
    expect(raw.anchor).toBe(3);
    expect(raw.options.offset).toBeInstanceOf(ctx.fake.namespace.Size);
    expect(raw.options.offset).toMatchObject({ width: 83, height: 18 });
  });

  it("非四角落点：换算成数值但告警一次（4.0 只支持四角，SDK 会静默回落）", () => {
    const handle = ctx.controls.create("scale", { anchor: "BMAP_ANCHOR_TOP_CENTER" });
    expect(ctx.rawOf(handle).anchor).toBe(4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("不是四角落点");
  });

  it("不认识的位置常量：告警一次且不透传（控件沿用自身默认落点）", () => {
    const handle = ctx.controls.create("zoom", { anchor: "BMAP_ANCHOR_TOP" });
    expect(ctx.rawOf(handle).anchor).toBeNull();
    expect(ctx.rawOf(handle).options.anchor).toBeUndefined();
    expect(String(warn.mock.calls[0][0])).toContain("不认识的停靠位置");
  });

  it("未知选项原样透传（项目 option 接口的索引签名就是 4.0 自身构造选项的逃生口）", () => {
    const handle = ctx.controls.create("city-list", { expand: true, canCheckSize: false });
    expect(ctx.rawOf(handle).options).toMatchObject({ expand: true, canCheckSize: false });
  });

  it("create('custom') 显式失败并指向 createCustomControl", () => {
    expect(() => ctx.controls.create("custom")).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("命名空间缺该构造器时显式失败，不静默返回空控件", () => {
    const namespace = { ...ctx.fake.namespace } as Record<string, unknown>;
    delete namespace.MapTypeControl;
    const isolated = setup(namespace);
    expect(() => isolated.controls.create("map-type")).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 2. 自定义控件                                                                 */
/* -------------------------------------------------------------------------- */

describe("自定义控件（BControl 的 Driver 侧）", () => {
  it("defaultAnchor / defaultOffset 用 4.0 取值，initialize 拿到地图容器", () => {
    const rendered: HTMLElement[] = [];
    const handle = ctx.controls.createCustomControl({
      anchor: "BMAP_ANCHOR_TOP_LEFT",
      offset: { x: 10, y: 20 },
      render: (mapContainer) => {
        rendered.push(mapContainer);
        return mapContainer.appendChild(document.createElement("button"));
      },
    });
    const raw = ctx.rawOf(handle);

    expect(raw).toBeInstanceOf(ctx.fake.namespace.Control);
    expect(raw.defaultAnchor).toBe(0);
    expect(raw.defaultOffset).toMatchObject({ width: 10, height: 20 });

    ctx.controls.add(ctx.mapTarget(), handle);
    // 官方在 addControl 内部调用 initialize(map) 取 DOM
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toBe(ctx.container);
    expect(ctx.rawMap.controls).toHaveLength(1);
  });

  it("render 返回 null 时回落到地图容器本身（官方 getContainer() 语义）", () => {
    const handle = ctx.controls.createCustomControl({ render: () => null });
    const initialize = ctx.rawOf(handle).initialize as (map: unknown) => HTMLElement;
    expect(initialize(ctx.rawMap)).toBe(ctx.container);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. add / remove / show / hide                                                */
/* -------------------------------------------------------------------------- */

describe("控件挂载、显隐与 Target 所有权", () => {
  it("add → remove 精确记账；重复 add 只挂一次；remove 后可重挂", () => {
    const target = ctx.mapTarget();
    const control = ctx.controls.create("zoom");

    ctx.controls.add(target, control);
    ctx.controls.add(target, control);
    expect(ctx.rawMap.controls).toHaveLength(1);

    ctx.controls.remove(target, control);
    expect(ctx.rawMap.controls).toHaveLength(0);
    expect(ctx.rawOf(control).attachedMap).toBeNull();

    ctx.controls.add(target, control);
    expect(ctx.rawMap.controls).toHaveLength(1);
  });

  it("show / hide 落到控件实例", () => {
    const control = ctx.controls.create("zoom");
    ctx.controls.hide(control);
    expect(ctx.rawOf(control).visible).toBe(false);
    ctx.controls.show(control);
    expect(ctx.rawOf(control).visible).toBe(true);
  });

  it("控件缺基类成员时告警一次，不抛错也不静默（PanoramaControl 由全景模块提供）", () => {
    const control = ctx.controls.create("panorama");
    // 官方：PanoramaControl 由全景模块提供、不保证 Control 基类成员。成员在原型上，
    // 因此必须用自有属性**遮蔽**原型方法才能模拟「当前实例没有 show()」。
    Object.defineProperty(ctx.rawOf(control), "show", { value: undefined, configurable: true });

    expect(() => ctx.controls.show(control)).not.toThrow();
    expect(String(warn.mock.calls[0][0])).toContain("没有 show()");
  });

  it("非 Map 目标显式失败，且不产生半挂载", () => {
    const control = ctx.controls.create("zoom");
    expect(() => ctx.controls.add({ kind: "overlay", handle: control }, control)).toThrowError(
      expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
    );
    expect(ctx.rawMap.controls).toHaveLength(0);
  });

  it("拒绝跨 Client 的句柄（BMAP_HANDLE_FOREIGN）", () => {
    const other = setup();
    const foreign = other.controls.create("zoom");
    expect(() => ctx.controls.add(ctx.mapTarget(), foreign)).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 4. options 更新：动态项 vs 构造期项                                          */
/* -------------------------------------------------------------------------- */

describe("setOptions 的动态 / 构造期分类", () => {
  it("anchor / offset 是公共动态项", () => {
    const control = ctx.controls.create("zoom");
    ctx.controls.setOptions(control, {
      anchor: "BMAP_ANCHOR_TOP_LEFT",
      offset: { x: 1, y: 2 },
    });
    const raw = ctx.rawOf(control);
    expect(raw.anchor).toBe(0);
    expect(raw.offset).toMatchObject({ width: 1, height: 2 });
  });

  it("kind 专属动态项：scale.unit / navigation.type / overview.size", () => {
    const scale = ctx.controls.create("scale");
    ctx.controls.setOptions(scale, { unit: "BMAP_UNIT_IMPERIAL" });
    expect(ctx.rawOf(scale).unit).toBe("BMAP_UNIT_IMPERIAL");

    // navigation 的 setType 要求控件先挂载（真实 4.0 实测：内部滑块 DOM 在 initialize 时才建）
    const navigation = ctx.controls.create("navigation");
    ctx.controls.add(ctx.mapTarget(), navigation);
    ctx.controls.setOptions(navigation, { type: "BMAP_NAVIGATION_CONTROL_SMALL" });
    expect(ctx.rawOf(navigation).type).toBe("BMAP_NAVIGATION_CONTROL_SMALL");

    const overview = ctx.controls.create("overview");
    ctx.controls.setOptions(overview, { size: { x: 150, y: 150 } });
    expect(ctx.rawOf(overview).size).toMatchObject({ width: 150, height: 150 });
  });

  it("kind 专属 setter 在未挂载时抛错：Surface 成 BMapError 而不是被静默吞掉", () => {
    const navigation = ctx.controls.create("navigation");
    expect(() => ctx.controls.setOptions(navigation, { type: 1 })).toThrowError(
      expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
    );
  });

  it("成对动作型动态项：city-list.expand → open / close", () => {
    const control = ctx.controls.create("city-list");
    ctx.controls.setOptions(control, { expand: true });
    expect(ctx.rawOf(control).expanded).toBe(true);
    ctx.controls.setOptions(control, { expand: false });
    expect(ctx.rawOf(control).expanded).toBe(false);
    expect(ctx.rawOf(control).callLog).toEqual(["open", "close"]);
  });

  it("构造期项：map-type 的 type / mapTypes、overview.isOpen、city-list 的回调", () => {
    const mapType = ctx.controls.create("map-type");
    ctx.controls.setOptions(mapType, { type: "BMAP_MAPTYPE_CONTROL_DROPDOWN" });
    expect(ctx.rawOf(mapType).callLog).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toContain("只有构造期生效");

    const overview = ctx.controls.create("overview");
    ctx.controls.setOptions(overview, { isOpen: true });
    expect(ctx.rawOf(overview).callLog).toEqual([]);

    const cityList = ctx.controls.create("city-list");
    ctx.controls.setOptions(cityList, { trigger: document.createElement("button") });
    expect(ctx.rawOf(cityList).callLog).toEqual([]);
  });

  it("location 的 option 走「options 袋」整体写回（一次 setOptions 调用）", () => {
    const control = ctx.controls.create("location");
    ctx.controls.setOptions(control, { showAddressBar: false, watchPosition: true });
    const raw = ctx.rawOf(control);
    expect(raw.appliedBags).toEqual([{ showAddressBar: false, watchPosition: true }]);
    expect(raw.options).toMatchObject({ showAddressBar: false, watchPosition: true });
  });

  it("未知键走 set<Key> 逃生口，实例上没有该方法时告警一次", () => {
    const control = ctx.controls.create("zoom");
    ctx.controls.setOptions(control, { noSuchOption: 1 });
    expect(ctx.rawOf(control).callLog).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toContain("没有 \"noSuchOption\" 的字段级 setter");
  });
});

/* -------------------------------------------------------------------------- */
/* 5. 版权控件                                                                  */
/* -------------------------------------------------------------------------- */

describe("CopyrightControl 的版权增删查", () => {
  it("addCopyright / listCopyrights 往返（含 bounds）", () => {
    const control = ctx.controls.create("copyright");
    const bounds = { southwest: { lng: 116.3, lat: 39.8 }, northeast: { lng: 116.5, lat: 40 } };

    ctx.controls.addCopyright(control, { id: 1, content: "<b>版权所有</b>" });
    ctx.controls.addCopyright(control, { id: 2, content: "自定义", bounds });

    expect(ctx.controls.listCopyrights(control)).toEqual([
      { id: 1, content: "<b>版权所有</b>" },
      { id: 2, content: "自定义", bounds },
    ]);
  });

  it("同 id 重复添加按官方语义覆盖", () => {
    const control = ctx.controls.create("copyright");
    ctx.controls.addCopyright(control, { id: 7, content: "旧" });
    ctx.controls.addCopyright(control, { id: 7, content: "新" });
    expect(ctx.controls.listCopyrights(control)).toEqual([{ id: 7, content: "新" }]);
  });

  it("removeCopyright 按 id 移除", () => {
    const control = ctx.controls.create("copyright");
    ctx.controls.addCopyright(control, { id: 1, content: "a" });
    ctx.controls.removeCopyright(control, 1);
    expect(ctx.controls.listCopyrights(control)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. 释放顺序（跨 Facet 不变式）                                                */
/* -------------------------------------------------------------------------- */

describe("控件释放顺序", () => {
  it("先摘控件再销毁地图：destroyedWithControls 为 0", () => {
    const target = ctx.mapTarget();
    const controls = CONTROL_KINDS.map(([kind]) => ctx.controls.create(kind));
    for (const control of controls) ctx.controls.add(target, control);
    expect(ctx.rawMap.controls).toHaveLength(controls.length);

    for (const control of controls) ctx.controls.remove(target, control);
    ctx.rawMap.destroy();

    expect(ctx.rawMap.destroyedWithControls).toBe(0);
  });

  it("遗漏摘除时该不变式会失败（证明这条检查不是空转）", () => {
    ctx.controls.add(ctx.mapTarget(), ctx.controls.create("zoom"));
    ctx.rawMap.destroy();
    expect(ctx.rawMap.destroyedWithControls).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. 句柄品牌（setOptions 分类的依据）                                          */
/* -------------------------------------------------------------------------- */

describe("控件句柄品牌", () => {
  it("每个 kind 的句柄都带 control:<kind> 品牌，便于按种类给出更新口径", () => {
    for (const [kind] of CONTROL_KINDS) {
      const handle = ctx.controls.create(kind);
      expect(handle[HANDLE_BRAND]).toBe(`control:${kind}`);
    }
    const custom = ctx.controls.createCustomControl({ render: () => null });
    expect(custom[HANDLE_BRAND]).toBe("control:custom");
  });
});
