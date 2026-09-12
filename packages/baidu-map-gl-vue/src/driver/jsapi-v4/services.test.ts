/**
 * v4 Service Facet 单测（M3A2-SERVICES-NATIVE / issue #23）
 *
 * 覆盖 issue「测试要求」的基础服务部分：**成功 / 失败 / 空结果 / 取消 / 迟到回调**，
 * 外加能力守卫、句柄所有权与参数校验。断言全部落在可观测事实（Fake 的 `callLog`、
 * `_rd` 注册表、归一化结果的 `status`/`sdkStatus`）上。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeBMapV4, type FakeBMapV4 } from "../../../../test-utils";
import { CAPABILITY_CATALOG } from "../capability/catalog";
import { createCapabilityRegistry } from "../capability/registry";
import type { CapabilityRegistry } from "../capability/registry";
import type { UnsupportedBehavior } from "../capability/unsupported";
import { createJsapiV4GeometryDriver } from "./geometry";
import { createJsapiV4HandleRegistry } from "./registry";
import type { JsapiV4HandleRegistry } from "./registry";
import { createJsapiV4ServiceDriver } from "./services";
import type { JsapiV4ServiceDriver } from "../types/services";

let fake: FakeBMapV4;
let registry: JsapiV4HandleRegistry;
let capabilities: CapabilityRegistry;
let services: JsapiV4ServiceDriver;

function buildDriver(unsupported: UnsupportedBehavior = "throw"): JsapiV4ServiceDriver {
  const geometry = createJsapiV4GeometryDriver(fake.namespace);
  capabilities = createCapabilityRegistry({
    engine: "jsapi-v4",
    version: fake.namespace.VERSION,
    rawSdk: fake.namespace,
    unsupported,
  });
  return createJsapiV4ServiceDriver({
    rawSdk: fake.namespace,
    geometry,
    capabilities,
    registry,
  });
}

/**
 * 程序化检索用的输入框：**必须不可输入**（`readOnly`）。
 *
 * `Autocomplete` 的回包通道与输入框共享：可输入的输入框上，用户输入触发的同关键词回包与程序化
 * 回包无法区分，因此 `suggest()` 会拒绝（四轮复审 P2-2）。要「通道独占」，输入框必须是
 * `readOnly` / `disabled` / `type="hidden"` 之一。
 */
function input(): HTMLInputElement {
  const el = document.createElement("input");
  el.readOnly = true;
  document.body.appendChild(el);
  return el;
}

/** 可输入的输入框（默认形态）：用于验证 `suggest()` 的「通道独占」前置拒绝。 */
function typableInput(): HTMLInputElement {
  const el = document.createElement("input");
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  fake = createFakeBMapV4();
  registry = createJsapiV4HandleRegistry();
  services = buildDriver();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("v4 Service Facet：创建面", () => {
  it("六个基础服务 + ViewAnimation 都能创建，句柄品牌带种类", () => {
    expect(services.createGeocoder().raw).toBeTruthy();
    expect(services.createConvertor().raw).toBeTruthy();
    expect(services.createGeolocation().raw).toBeTruthy();
    expect(services.createLocalCity().raw).toBeTruthy();
    expect(services.createBoundary().raw).toBeTruthy();
    expect(services.createAutocomplete({ input: input() }).raw).toBeTruthy();
    const animation = services.createViewAnimation([
      { center: { lng: 116.4, lat: 39.9 }, zoom: 12, percentage: 0 },
      { center: { lng: 116.4, lat: 39.9 }, zoom: 16, percentage: 1 },
    ]);
    expect(animation.raw).toBeTruthy();

    expect(registry.lookup(fake.createdGeocoders[0])).toBeTruthy();
    expect(fake.createdConvertors).toHaveLength(1);
    expect(fake.createdGeolocations).toHaveLength(1);
    expect(fake.createdLocalCities).toHaveLength(1);
    expect(fake.createdBoundaries).toHaveLength(1);
    expect(fake.createdAutocompletes).toHaveLength(1);
  });

  it("ViewAnimation 把领域 center 换成 raw Point，并保留 interation 约定", () => {
    const handle = services.createViewAnimation(
      [{ center: { lng: 116.4, lat: 39.9 }, zoom: 12, percentage: 0 }],
      { duration: 500, loop: 3 },
    );
    const raw = handle.raw as {
      keyFrames: Array<{ center?: unknown }>;
      options: Record<string, unknown>;
    };

    // 领域 Point → SDK Point 构造器（几何转换的事实由 instanceof 断言，而不是「看起来像」）
    expect(raw.keyFrames[0].center).toBeInstanceOf(fake.namespace.Point);
    expect(raw.options).toEqual({ duration: 500, delay: 0, interation: 3 });
  });

  it("TrackAnimation 按 Catalog 的 unsupported 显式失败，并指向 TrackLine", () => {
    const map = registry.adopt("map", new fake.namespace.Map(document.createElement("div")));
    expect(() => services.createTrackAnimation(map, [{ lng: 116.4, lat: 39.9 }])).toThrowError(
      expect.objectContaining({
        code: "BMAP_CAPABILITY_UNSUPPORTED",
        message: expect.stringContaining("TrackLine"),
      }),
    );
    expect(CAPABILITY_CATALOG["service.track-animation"].status).toBe("unsupported");
  });

  it("能力缺失时：throw 策略在构造前失败，warn 策略落到构造器缺失的统一错误", () => {
    const namespace = fake.namespace as unknown as Record<string, unknown>;
    const original = namespace.Geocoder;
    delete namespace.Geocoder;
    try {
      expect(() => services.createGeocoder()).toThrowError(
        expect.objectContaining({ code: "BMAP_CAPABILITY_UNSUPPORTED" }),
      );
      const lenient = buildDriver("warn");
      expect(() => lenient.createGeocoder()).toThrowError(
        expect.objectContaining({ code: "BMAP_SDK_CALL_FAILED" }),
      );
    } finally {
      namespace.Geocoder = original;
    }
  });

  it("拒绝其它 Client 的句柄", () => {
    const other = createJsapiV4ServiceDriver({
      rawSdk: fake.namespace,
      geometry: createJsapiV4GeometryDriver(fake.namespace),
      capabilities,
      registry: createJsapiV4HandleRegistry(),
    });
    const foreign = other.createGeocoder();
    expect(() => services.geocode(foreign, { address: "北京市海淀区中关村" })).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});

describe("v4 Service Facet：Geocoder（正/逆地址解析）", () => {
  it("成功：回包坐标归一为领域 Point", async () => {
    const handle = services.createGeocoder();
    const result = await services.geocode(handle, { address: "北京市海淀区中关村" }).result;

    expect(result.status).toBe("success");
    expect(result.data).toEqual({ lng: 116.404, lat: 39.915 });
    expect(fake.createdGeocoders[0].callLog).toEqual(["getPoint:北京市海淀区中关村:"]);
  });

  it("空结果：SDK 回 null 且没有服务端错误码", async () => {
    const handle = services.createGeocoder();
    fake.createdGeocoders[0].pointResult = null;

    const result = await services.geocode(handle, { address: "查无此地" }).result;
    expect(result.status).toBe("empty");
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
  });

  it("失败：null 回包 + JSONP 注册表里的错误码 ⇒ failed（不是 empty）", async () => {
    const handle = services.createGeocoder();
    fake.createdGeocoders[0].pointResult = null;
    fake.createdGeocoders[0].jsonpError = { code: 302, message: "当天配额已用完" };

    const result = await services.geocode(handle, { address: "北京市海淀区中关村" }).result;
    expect(result.status).toBe("failed");
    expect(result.error).toEqual({ code: 302, message: "当天配额已用完" });
  });

  it("参数非法：不抛错，以 BMAP_INVALID_ARGUMENT 结算", async () => {
    const handle = services.createGeocoder();
    const result = await services.geocode(handle, { address: "" }).result;

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    expect(fake.createdGeocoders[0].callLog).toHaveLength(0);
  });

  it("迟到回调：取消之后回包不改结果", async () => {
    const handle = services.createGeocoder();
    const geocoder = fake.createdGeocoders[0];
    geocoder.queue.auto = false;

    const call = services.geocode(handle, { address: "北京市海淀区中关村" });
    call.cancel();
    expect(geocoder.queue.flush()).toBe(1);

    const result = await call.result;
    expect(result.status).toBe("canceled");
    expect(result.data).toBeNull();
  });

  it("超时：SDK 不回包时给出 timeout，随后的迟到回包被忽略", async () => {
    vi.useFakeTimers();
    const handle = services.createGeocoder();
    const geocoder = fake.createdGeocoders[0];
    geocoder.queue.auto = false;

    const call = services.geocode(handle, { address: "北京市海淀区中关村" });
    vi.advanceTimersByTime(15000);
    expect((await call.result).status).toBe("timeout");

    geocoder.queue.flush();
    expect((await call.result).status).toBe("timeout");
  });

  it("逆地址解析：地址、商圈与附近 POI 计数", async () => {
    const handle = services.createGeocoder();
    const result = await services.reverseGeocode(handle, {
      point: { lng: 116.404, lat: 39.915 },
      numPois: 5,
    }).result;

    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      address: "北京市东城区天安门",
      point: { lng: 116.404, lat: 39.915 },
      business: "天安门",
      poiCount: 2,
    });
    expect(fake.createdGeocoders[0].callLog[0]).toBe('getLocation:{"numPois":5}');
  });
});

describe("v4 Service Facet：Convertor / Boundary", () => {
  it("坐标转换成功：status 0 时给出坐标数组", async () => {
    const handle = services.createConvertor();
    const result = await services.convert(handle, {
      points: [{ lng: 116.3, lat: 39.9 }],
      from: 1,
      to: 5,
    }).result;

    expect(result.status).toBe("success");
    expect(result.data).toEqual([{ lng: 116.404, lat: 39.915 }]);
    expect(result.sdkStatus).toBe(0);
    expect(fake.createdConvertors[0].callLog).toEqual(["translate:1:1->5"]);
  });

  it("坐标转换失败：status 非 0 走 failed 并带回状态码", async () => {
    const handle = services.createConvertor();
    const convertor = fake.createdConvertors[0];
    convertor.status = 1;
    convertor.points = null;
    convertor.message = "坐标超出范围";

    const result = await services.convert(handle, {
      points: [{ lng: 116.3, lat: 39.9 }],
      from: 1,
      to: 5,
    }).result;

    expect(result.status).toBe("failed");
    expect(result.error).toEqual({ code: 1, message: "坐标超出范围" });
    expect(result.sdkStatus).toBe(1);
  });

  it("坐标转换为空输入：参数校验失败，不触碰 SDK", async () => {
    const handle = services.createConvertor();
    const result = await services.convert(handle, { points: [], from: 1, to: 5 }).result;

    expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    expect(fake.createdConvertors[0].callLog).toHaveLength(0);
  });

  it("坐标转换：非法坐标走结果通道（failed + BMAP_INVALID_ARGUMENT），不绕过封装同步抛错", async () => {
    const handle = services.createConvertor();
    const cases: Array<Record<string, unknown>> = [
      { lng: Number.NaN, lat: 39.9 },
      { lng: Number.POSITIVE_INFINITY, lat: 39.9 },
      { lng: 116.4 },
    ];

    for (const bad of cases) {
      const request = {
        points: [bad] as unknown as [never],
        from: 1 as const,
        to: 5 as const,
      };
      // 「连 ServiceCall 都没返回」就是本用例要挡的形态：调用必须不抛错
      let call!: ReturnType<typeof services.convert>;
      expect(() => {
        call = services.convert(handle, request);
      }, `非法坐标 ${JSON.stringify(bad)} 同步抛错了`).not.toThrow();

      const result = await call.result;
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("BMAP_INVALID_ARGUMENT");
    }

    // 一次都不该落到 SDK
    expect(fake.createdConvertors[0].callLog).toHaveLength(0);
  });

  it("行政区边界：点串解析成坐标环", async () => {
    const handle = services.createBoundary();
    const result = await services.queryBoundary(handle, { name: "北京市" }).result;

    expect(result.status).toBe("success");
    expect(result.data).toEqual([
      [
        { lng: 116.3, lat: 39.9 },
        { lng: 116.31, lat: 39.91 },
        { lng: 116.3, lat: 39.9 },
      ],
    ]);
  });

  it("行政区边界：空数组是 empty，null + 错误码是 failed", async () => {
    const handle = services.createBoundary();
    const boundary = fake.createdBoundaries[0];

    boundary.boundaries = [];
    expect((await services.queryBoundary(handle, { name: "北京市" }).result).status).toBe("empty");

    boundary.boundaries = null;
    boundary.jsonpError = { code: 5, message: "非法请求" };
    const failed = await services.queryBoundary(handle, { name: "北京市" }).result;
    expect(failed.status).toBe("failed");
    expect(failed.error).toEqual({ code: 5, message: "非法请求" });
  });
});

describe("v4 Service Facet：Geolocation / LocalCity", () => {
  it("定位成功：sdkStatus 与精度、地址一起归一", async () => {
    const handle = services.createGeolocation();
    const result = await services.locate(handle, { enableHighAccuracy: true }).result;

    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      point: { lng: 116.404, lat: 39.915 },
      accuracy: 30,
      address: { city: "北京市", district: "东城区" },
    });
    expect(result.sdkStatus).toBe(0);
    expect(fake.createdGeolocations[0].callLog[1]).toBe(
      'getCurrentPosition:{"enableHighAccuracy":true}',
    );
  });

  it("定位失败：getStatus 的 BMAP_STATUS_* 变成可读原因", async () => {
    const handle = services.createGeolocation();
    const geolocation = fake.createdGeolocations[0];
    geolocation.status = 6;
    geolocation.result = null;

    const result = await services.locate(handle).result;
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe(6);
    expect(result.error?.message).toContain("定位权限被拒绝");
    expect(result.sdkStatus).toBe(6);
  });

  it("IP 定位：城市名 + 中心点；无城市名时是 empty", async () => {
    const handle = services.createLocalCity();
    expect((await services.locateCity(handle).result).data).toEqual({
      name: "北京市",
      center: { lng: 116.404, lat: 39.915 },
      level: 12,
    });

    fake.createdLocalCities[0].result = { name: "" };
    expect((await services.locateCity(handle).result).status).toBe("empty");
  });

  it("IP 定位：null 回包 + JSONP 错误码 ⇒ failed（不是「查不到城市」）", async () => {
    const handle = services.createLocalCity();
    const localCity = fake.createdLocalCities[0];
    localCity.result = null;
    localCity.jsonpError = { code: 302, message: "当天配额已用完" };

    const result = await services.locateCity(handle).result;
    expect(result.status).toBe("failed");
    expect(result.error).toEqual({ code: 302, message: "当天配额已用完" });
  });

  it("IP 定位：null 回包但没有服务端错误码 ⇒ 仍是 empty", async () => {
    const handle = services.createLocalCity();
    fake.createdLocalCities[0].result = null;

    const result = await services.locateCity(handle).result;
    expect(result.status).toBe("empty");
    expect(result.error).toBeNull();
  });
});

describe("v4 Service Facet：Autocomplete（事件式服务的归一化）", () => {
  it("成功：search 后由内部监听结算，并转发业务自己的 onSearchComplete", async () => {
    const onSearchComplete = vi.fn();
    const handle = services.createAutocomplete({ input: input(), onSearchComplete });
    fake.createdAutocompletes[0].pois = [
      { business: "天安门", province: "北京市", district: "东城区" },
      { province: "北京市", city: "北京市", street: "中关村大街" },
    ];

    const result = await services.suggest(handle, "天安门").result;

    expect(result.status).toBe("success");
    expect(result.data).toEqual([
      { title: "天安门", address: "北京市东城区", index: 0 },
      { title: "北京市北京市中关村大街", address: "北京市北京市中关村大街", index: 1 },
    ]);
    // 业务监听没有被内部发生器吞掉
    expect(onSearchComplete).toHaveBeenCalledTimes(1);
    expect(fake.createdAutocompletes[0].callLog).toContain("search:天安门");
  });

  it("空结果：回包但没有任何条目", async () => {
    const handle = services.createAutocomplete({ input: input() });
    fake.createdAutocompletes[0].pois = [];

    const result = await services.suggest(handle, "不存在的关键字").result;
    expect(result.status).toBe("empty");
    expect(result.data).toBeNull();
  });

  it("取消之后到达的回包仍然转给业务监听，但不复活本次调用", async () => {
    const onSearchComplete = vi.fn();
    const handle = services.createAutocomplete({ input: input(), onSearchComplete });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    const call = services.suggest(handle, "天安门");
    call.cancel();
    autocomplete.queue.flush();

    expect((await call.result).status).toBe("canceled");
    expect(onSearchComplete).toHaveBeenCalledTimes(1);
  });
});

describe("v4 Service Facet：Autocomplete 的回包归属（PR #63 复审 P2-1）", () => {
  it("可输入的输入框 ⇒ suggest() 被拒绝（回包通道与用户输入共享，无法区分）", async () => {
    const handle = services.createAutocomplete({ input: typableInput() });

    const result = await services.suggest(handle, "K").result;
    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("无法区分");
    // 请求根本不该发出去
    expect(fake.createdAutocompletes[0].callLog).not.toContain("search:K");
  });

  it("readOnly 输入框 ⇒ 通道独占，suggest() 正常可用", async () => {
    const handle = services.createAutocomplete({ input: input() });

    const result = await services.suggest(handle, "天安门").result;
    expect(result.status).toBe("success");
    expect(fake.createdAutocompletes[0].callLog).toContain("search:天安门");
  });

  // 五轮复审 P2：独占判定不能只信构造时的状态——HTML 控件的可编辑性取决于**当前**的
  // disabled / readonly / type，构造之后随时可以变回可输入。
  const HIDDEN = (el: HTMLInputElement): void => {
    el.type = "hidden";
  };
  const DISABLED = (el: HTMLInputElement): void => {
    el.disabled = true;
  };
  const READONLY = (el: HTMLInputElement): void => {
    el.readOnly = true;
  };

  it.each([
    ["disabled 被取消", DISABLED, (el: HTMLInputElement) => (el.disabled = false)],
    ["readOnly 被取消", READONLY, (el: HTMLInputElement) => (el.readOnly = false)],
    ["type 从 hidden 改为 text", HIDDEN, (el: HTMLInputElement) => (el.type = "text")],
  ])("构造后输入框恢复可输入（%s）⇒ suggest() 必须拒绝", async (_name, makeExclusive, makeTypable) => {
    const el = document.createElement("input");
    makeExclusive(el);
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });

    makeTypable(el);

    const result = await services.suggest(handle, "K").result;
    expect(result.status).toBe("failed");
    expect(fake.createdAutocompletes[0].callLog).not.toContain("search:K");
  });

  it("等待回包期间输入框恢复可输入 ⇒ 该调用必须显式失败（不能接受可能来自用户输入的回包）", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "NEW", province: "北京市" }];
    const call = services.suggest(handle, "K");

    // 等待期间用户把输入框变回可输入，然后键入同关键词 → 原生检索的回包（TYPED）到达
    el.readOnly = false;
    autocomplete.pois = [{ business: "TYPED", province: "上海市" }];
    const raw = autocomplete as unknown as { search(keyword: string): void };
    raw.search("K");
    autocomplete.queue.flush();

    const result = await call.result;
    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
  });

  it("一旦观察到失去独占（可编辑期间已可能产生原生请求），即使又变回只读也不恢复资格", async () => {
    const el = document.createElement("input");
    el.readOnly = true;
    document.body.appendChild(el);
    const handle = services.createAutocomplete({ input: el });

    // 观察到失去独占：可编辑期间调用被拒绝（同时实例被永久标记）
    el.readOnly = false;
    expect((await services.suggest(handle, "K").result).status).toBe("failed");

    el.readOnly = true; // 又变回只读 —— 不能因此恢复
    const result = await services.suggest(handle, "K").result;
    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain("重建");
  });

  it("取消 A 之后 A 的迟到回包不得结算 B", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "AAA", province: "北京市" }];
    const a = services.suggest(handle, "A");
    a.cancel();

    autocomplete.pois = [{ business: "BBB", province: "上海市" }];
    const b = services.suggest(handle, "B");

    // A 与 B 各回一次包，A 的先到（结果里带着 A 的条目 AAA）
    expect(autocomplete.queue.flush()).toBe(2);
    const result = await b.result;

    // 归属错了的表现就是「B 拿到了 A 的结果」：断言标题必须是 B 自己的 BBB
    expect(result.status).toBe("success");
    expect(result.data?.[0]?.title).toBe("BBB");
    expect((await a.result).status).toBe("canceled");
  });

  it("发起 A → 发起 B → 取消 A：B 仍由自己的回包结算，不因取消 A 被清空", async () => {
    vi.useFakeTimers();
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "AAA", province: "北京市" }];
    const a = services.suggest(handle, "A");
    autocomplete.pois = [{ business: "BBB", province: "上海市" }];
    const b = services.suggest(handle, "B");
    a.cancel();

    expect(autocomplete.queue.flush()).toBe(2);
    vi.advanceTimersByTime(15000);
    const result = await b.result;

    expect(result.status).toBe("success");
    expect(result.data?.[0]?.title).toBe("BBB");
  });

  it("没有 pending suggest 的回包（用户在输入框里打字触发）不会误结算任何调用", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    // 直接 search（不入 pending 队列）后回包：不应抛错、也不应影响后续的 suggest
    const raw = autocomplete as unknown as { search(keyword: string): void };
    raw.search("typed-by-user");
    autocomplete.queue.flush();

    const call = services.suggest(handle, "天安门");
    autocomplete.queue.flush();
    expect((await call.result).status).toBe("success");
  });

  it("乱序回包（B 的先到）：按 keyword 关联，不串线", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "AAA", province: "北京市" }];
    const a = services.suggest(handle, "A");
    autocomplete.pois = [{ business: "BBB", province: "上海市" }];
    const b = services.suggest(handle, "B");

    // 乱序：B 的回包先到（官方 `AutocompleteResult.keyword` 是唯一的请求关联依据）
    expect(autocomplete.queue.flushOne(1)).toBe(true);
    expect((await b.result).data?.[0]?.title).toBe("BBB");

    expect(autocomplete.queue.flushOne(0)).toBe(true);
    expect((await a.result).data?.[0]?.title).toBe("AAA");
  });

  it("回包不带 keyword 时退化为 FIFO（顺序到达仍然正确）", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;
    // 官方把 `keyword` 声明为可选，运行时不保证填充 → 这条路径必须仍然可用
    autocomplete.includeKeyword = false;

    autocomplete.pois = [{ business: "AAA", province: "北京市" }];
    const a = services.suggest(handle, "A");
    autocomplete.pois = [{ business: "BBB", province: "上海市" }];
    const b = services.suggest(handle, "B");

    autocomplete.queue.flush();
    expect((await a.result).data?.[0]?.title).toBe("AAA");
    expect((await b.result).data?.[0]?.title).toBe("BBB");
  });

  it("回包带 keyword 但与任何 pending 都不匹配时，不得结算 queue 里的下一个调用", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    // 先让一个 suggest 处于 pending（回包还没到）
    autocomplete.pois = [{ business: "BBB", province: "上海市" }];
    const b = services.suggest(handle, "B");

    // 用户在输入框里打字触发的搜索（不经过 suggest）：它的回包带自己的 keyword
    autocomplete.pois = [{ business: "TYPED", province: "北京市" }];
    const raw = autocomplete as unknown as { search(keyword: string): void };
    raw.search("typed-by-user");

    // 用户输入那次的回包先到（index 1）——它不属于任何 pending
    expect(autocomplete.queue.flushOne(1)).toBe(true);
    // B 自己的回包随后到达
    expect(autocomplete.queue.flushOne(0)).toBe(true);

    const result = await b.result;
    expect(result.status).toBe("success");
    expect(result.data?.[0]?.title).toBe("BBB");
  });

  // 二轮复审曾要求「同关键词重试必须由新回包结算」（当时用「取最新同名项」实现）。三轮复审用
  // **按请求顺序正常返回**的反例证明那条规则会把旧回包塞给新请求；而「取最早同名项」又会在
  // 旧回包始终不到达时让新请求饿死。两者都只是「按到达时间猜」，因为 `Autocomplete` 的回包
  // **不带请求身份**。因此契约改为：**同关键词的并发/重叠请求直接显式失败**——这样同一关键词
  // 在任意时刻最多只有一个槽位，回包归属与到达顺序无关（两种顺序都正确）。
  it("取消旧 K 后立刻重查同关键词：显式失败（回包无法区分），旧结果不得交给新请求", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "K-OLD", province: "北京市" }];
    const oldCall = services.suggest(handle, "K");
    oldCall.cancel();

    const retry = services.suggest(handle, "K");
    const result = await retry.result;
    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("无法区分");

    // 旧回包（按请求顺序先到）必须被它自己的槽位吸收，不能落到别处
    expect(autocomplete.queue.flush()).toBe(1);
    expect(autocomplete.queue.pending).toBe(0);
  });

  it("同关键词超时后立刻重查：同样显式失败（旧回包随时可能到达）", async () => {
    vi.useFakeTimers();
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "K-OLD", province: "北京市" }];
    const first = services.suggest(handle, "K");
    vi.advanceTimersByTime(15000);
    expect((await first.result).status).toBe("timeout");

    const retry = services.suggest(handle, "K");
    expect((await retry.result).status).toBe("failed");
  });

  it("同关键词两次并发：第二次被拒绝，两个调用的结果绝不互换", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "K1", province: "北京市" }];
    const first = services.suggest(handle, "K");
    const second = services.suggest(handle, "K");

    expect((await second.result).status).toBe("failed");
    // 只有一个请求真的发出去了，因此它的回包只属于它自己
    expect(autocomplete.callLog.filter((entry) => entry.startsWith("search:"))).toEqual(["search:K"]);
    autocomplete.queue.flush();
    expect((await first.result).data?.[0]?.title).toBe("K1");
  });

  it("旧 K 的回包到达（槽位释放）之后，同关键词重查可以正常进行", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "K-OLD", province: "北京市" }];
    const oldCall = services.suggest(handle, "K");
    oldCall.cancel();
    autocomplete.queue.flush(); // 旧回包到达 → 槽位释放

    autocomplete.pois = [{ business: "K-NEW", province: "上海市" }];
    const retry = services.suggest(handle, "K");
    autocomplete.queue.flush();
    expect((await retry.result).data?.[0]?.title).toBe("K-NEW");
  });

  it("不同关键词的取消 + 重查不受限制（最常见用法仍然可用，且两种到达顺序都正确）", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    autocomplete.pois = [{ business: "A-OLD", province: "北京市" }];
    const first = services.suggest(handle, "A");
    first.cancel();
    autocomplete.pois = [{ business: "B", province: "上海市" }];
    const second = services.suggest(handle, "B");

    // 乱序到达：B 的回包先到
    expect(autocomplete.queue.flushOne(1)).toBe(true);
    expect((await second.result).data?.[0]?.title).toBe("B");
    expect(autocomplete.queue.flushOne(0)).toBe(true);
    expect((await first.result).status).toBe("canceled");
  });

  it("待回包队列达到上限时拒绝新调用（不淘汰旧记录），同关键词保护因此不会失效", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    // 旧 K 取消，回包仍在飞
    autocomplete.pois = [{ business: "K-OLD", province: "北京市" }];
    const oldK = services.suggest(handle, "K");
    oldK.cancel();

    // 再发起并取消 16 个不同关键词，把待回包记录顶到上限
    for (let index = 0; index < 16; index += 1) {
      autocomplete.pois = [{ business: `N${index}`, province: "北京市" }];
      services.suggest(handle, `N${index}`).cancel();
    }

    // 旧 K 的回包仍在飞：此时再次请求 K 必须被拒绝（淘汰记录会让它被误判为「不存在」）
    autocomplete.pois = [{ business: "K-NEW", province: "上海市" }];
    const retry = services.suggest(handle, "K");
    const result = await retry.result;

    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();

    // 旧回包到达后只能被它自己的记录吸收，不会落到任何别的调用上
    autocomplete.queue.flush();
    expect(result.data).toBeNull();
  });

  it("待回包队列达到上限：第 17 次调用被拒绝，已登记的请求仍各归其位", async () => {
    const handle = services.createAutocomplete({ input: input() });
    const autocomplete = fake.createdAutocompletes[0];
    autocomplete.queue.auto = false;

    const calls: Array<ReturnType<typeof services.suggest>> = [];
    for (let index = 0; index < 16; index += 1) {
      autocomplete.pois = [{ business: `N${index}`, province: "北京市" }];
      calls.push(services.suggest(handle, `K${index}`));
    }

    autocomplete.pois = [{ business: "N16", province: "北京市" }];
    const overflow = services.suggest(handle, "K16");
    expect((await overflow.result).status).toBe("failed");

    autocomplete.queue.flush();
    // 16 个已登记的请求各自拿到自己的回包（没有淘汰、也没有错位）
    expect((await calls[0]!.result).data?.[0]?.title).toBe("N0");
    expect((await calls[15]!.result).data?.[0]?.title).toBe("N15");
  });
});
