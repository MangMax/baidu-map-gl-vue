/**
 * v4 浏览器 smoke 的页面侧探针（真实浏览器 / headless Chromium）
 *
 * 与 `run.mts` 的分工：这里只负责**驱动真实页面**（组件路径 + 默认 Provider），把每一步的
 * 结论写进 `window.__SMOKE__`；进程编排、退出码与浏览器选择在 runner 里。这样同一个页面
 * 既能被人打开肉眼看，也能被 CDP 读。
 *
 * 三种输入：
 * - `?mode=fixture`（默认）：把 Fake v4 命名空间挂到 `globalThis.BMap`，走**完全相同的默认
 *   入口**（`createBMapPlugin({})` 的默认 Provider 会命中「复用既有全局」分支）。PR 门禁用它——
 *   不依赖 AK、不依赖网络、结论确定。
 * - `?mode=live&ak=...`：走默认 CDN Provider 的真实 `v=4.0` 入口。nightly / 手动用它。
 *
 * 两档期望分开写：真实环境只要求「结算且形状自洽」，把「真实环境必须成功」写死只会得到
 * 不稳定门禁（见 `packages/test-utils/facet-probes.ts` 的同一约定）。
 */
import { createApp, defineComponent, h, nextTick, type App, type VNode } from "vue";
import BMap from "@pkg/components/map/BMap.vue";
import BMapProvider from "@pkg/components/provider/BMapProvider.vue";
import BMarker from "@pkg/components/overlays/BMarker.vue";
import BPolyline from "@pkg/components/overlays/BPolyline.vue";
import BZoom from "@pkg/components/controls/BZoom.vue";
import BPanoramaCoverageLayer from "@pkg/components/layers/BPanoramaCoverageLayer.vue";
import { createBMapPlugin } from "@pkg/plugins/createBMapPlugin";
import { DEFAULT_VERSION, createBaiduSdkUrl } from "@pkg/core/loader/url";
import { existingGlobalV4Provider } from "@pkg/core/loader/providers";
import { SdkRegistry } from "@pkg/core/loader/SdkRegistry";
import { createFakeBMapV4, type FakeBMapV4 } from "@fake-v4";
import {
  SmokeRun,
  assertSmoke,
  fail,
  formatReport,
  withTimeout,
  type SmokeMode,
  type SmokeReport,
  type SmokeUnhandledEntry,
} from "./report.mts";

declare global {
  interface Window {
    __SMOKE__?: SmokeReport;
  }
}

const CENTER = { lng: 116.404, lat: 39.915 };
const POINT = { lng: 116.44, lat: 39.93 };
/** 服务探针用地址：与 `facet-probes.ts` 的 fixture 对齐，两档共用同一调用。 */
const ADDRESS = "北京市海淀区中关村";

const params = new URLSearchParams(location.search);
const MODE: SmokeMode = params.get("mode") === "live" ? "live" : "fixture";
const AK = params.get("ak") ?? "";
/**
 * `<BMap>` ready 的等待预算。
 *
 * live 档要等真实瓦片与 SDK 初始化，fixture 档是纯内存；排障时可以 `?readyMs=3000` 压低，
 * 不必为了看一条前置失败等满 30s×N。
 */
const READY_MS = Number(params.get("readyMs") ?? (MODE === "live" ? 30_000 : 10_000));

/** 未处理异常（验收标准要求「本库相关」为 0）。挂得足够早，才能捕获模块初始化期的异常。 */
const unhandled: SmokeUnhandledEntry[] = [];
addEventListener("error", (event) => {
  const detail = event as ErrorEvent;
  const source = detail.filename ?? "";
  unhandled.push({
    kind: "error",
    message: detail.message || "Script error.",
    source,
    // 跨域脚本（百度 SDK / BMapGLLib 插件）只给 "Script error."、无 filename，
    // 无法归属；判定规则见 report.mts 的 `SmokeUnhandledEntry`
    thirdParty: !source || !source.startsWith(location.origin),
  });
});
addEventListener("unhandledrejection", (event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  unhandled.push({
    kind: "rejection",
    message: reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
    source: "",
    // 本库的 promise 链都在同源模块里，不存在「跨域 rejection 无法归属」的问题
    thirdParty: false,
  });
});

interface MapReady {
  client: {
    engine: string;
    sdkVersion: string;
    driver: Record<string, any>;
  };
  map: unknown;
}

/**
 * 前置未就绪时的占位对象。
 *
 * 依赖探针（覆盖物 / 控件 / 图层 / 生命周期…）在 `map-ready` 失败时**必须仍然以 `BLOCKED`
 * 结算**，而不是让整份报告崩在 `undefined.getOverlays` 上——「一步失败不中断整轮」反过来也
 * 成立：前置没通过时后面的结论是「没跑」，不是「通过」。
 */
const blocked = (): never =>
  fail("BLOCKED", "前置探针 map-ready 未通过，本探针未执行（请先修前置）");

const BLOCKED_READY = {
  get client(): never {
    return blocked();
  },
  get map(): never {
    return blocked();
  },
} as unknown as MapReady;

/* -------------------------------------------------------------------------- */
/* 模式描述：两档的差异**只**集中在这里（用例只写领域语言）                      */
/* -------------------------------------------------------------------------- */

interface ModeDescriptor {
  /** 需要 AK 与网络（`live`）；否则用注入的 Fake 全局。 */
  live: boolean;
  /**
   * `getOverlays()` 读数下限。
   *
   * 主场景是 `<BMarker>` + `<BPolyline>` 两个覆盖物，因此两档都是 2；刻意**不含**
   * `<BInfoWindow>`（见 `infowindow-component-gap`）与打开的气泡，否则读数会随
   * 「气泡是否打开」漂移。官方 4.0 的 `map.getOverlays()` 会把打开的气泡也计入，
   * 那一条单独在 `overlay-infowindow-driver` 里记录，不混进这个下限。
   */
  minOverlays: number;
  /** 真实 SDK 才会派发 `tilesloaded`（Fake 没有瓦片管线）。 */
  expectsTilesLoaded: boolean;
  /** Fake 的诊断对象只在 fixture 档存在。 */
  fake?: FakeBMapV4;
}

let descriptor!: ModeDescriptor;

async function setupMode(): Promise<ModeDescriptor> {
  if (MODE === "fixture") {
    const fake = createFakeBMapV4();
    (globalThis as unknown as { BMap?: unknown }).BMap = fake.namespace;
    return { live: false, minOverlays: 2, expectsTilesLoaded: false, fake };
  }
  assertSmoke(
    AK.length >= 8,
    "MISSING_AK",
    "live 模式需要 `?ak=<百度地图 AK>`；nightly 从 secrets.BAIDU_MAP_AK 注入",
  );
  return { live: true, minOverlays: 2, expectsTilesLoaded: true };
}

/* -------------------------------------------------------------------------- */
/* 挂载助手                                                                    */
/* -------------------------------------------------------------------------- */

interface MountOptions {
  props?: Record<string, unknown>;
  children?: () => VNode | VNode[];
}

interface Mounted {
  host: HTMLElement;
  app: App;
  ready(): Promise<MapReady>;
  errors: unknown[];
  pluginReady: string[];
  pluginError: { name: string; error: unknown }[];
  unloaded: number;
  unmount(): Promise<void>;
}

function mountMap(options: MountOptions = {}, plugin?: unknown): Mounted {
  const host = document.createElement("div");
  host.style.width = "320px";
  host.style.height = "240px";
  document.body.appendChild(host);

  let resolveReady!: (payload: MapReady) => void;
  const ready = new Promise<MapReady>((resolve) => (resolveReady = resolve));
  const errors: unknown[] = [];
  const pluginReady: string[] = [];
  const pluginError: { name: string; error: unknown }[] = [];
  const state = { unloaded: 0 };

  const mapProps: Record<string, unknown> = {
    center: { ...CENTER },
    zoom: 14,
    ...options.props,
    onReady: (payload: MapReady) => resolveReady(payload),
    onError: (error: unknown) => errors.push(error),
    onUnload: () => {
      state.unloaded += 1;
    },
    onPluginReady: (name: string) => pluginReady.push(name),
    onPluginError: (payload: { name: string; error: unknown }) => pluginError.push(payload),
  };

  const root = defineComponent({
    name: "SmokeRoot",
    render() {
      return h(BMap, mapProps, options.children ? () => options.children!() : undefined);
    },
  });

  const app = createApp(root);
  if (plugin) app.use(plugin as never);
  app.mount(host);

  return {
    host,
    app,
    ready: () => ready,
    errors,
    pluginReady,
    pluginError,
    get unloaded() {
      return state.unloaded;
    },
    async unmount() {
      app.unmount();
      await nextTick();
      host.remove();
    },
  } as Mounted;
}

/* -------------------------------------------------------------------------- */
/* SDK 侧观测（两档差异之二：Fake 的账本 vs 真实 SDK 的读取接口）               */
/* -------------------------------------------------------------------------- */

interface Observation {
  overlays(): number;
  controls(): number | null;
  layers(): number | null;
  /** 未释放资源门禁：Fake 有精确诊断；真实 SDK 只能给「DOM 已清空」这类可观察量。 */
  assertNoLeaks(): void;
  notes: Record<string, unknown>;
}

/**
 * 「当前打开的气泡」读数（两档差异之三）。
 *
 * fixture 读 Fake 账本上的 `map.infoWindow`；live 走官方 `map.getInfoWindow()`——两档都读
 * **活状态**，不是「曾经打开过」。真实 4.0 的 `openInfoWindow` 是**异步生效**的（同 tick 仍为
 * `null`，约 100ms 后才可见），所以调用方必须轮询，不能同步断言。
 */
function readOpenInfoWindow(mapHandle: unknown): unknown {
  const raw = (mapHandle as { raw?: Record<string, unknown> } | null)?.raw;
  if (!raw) return null;
  if (descriptor.live) {
    const getter = raw.getInfoWindow;
    if (typeof getter !== "function") {
      fail("SDK_NO_READ_API", "真实 v4 Map 缺少 getInfoWindow()，气泡状态无法回读");
    }
    return (getter as () => unknown).call(raw) ?? null;
  }
  return (raw as { infoWindow?: unknown }).infoWindow ?? null;
}

const BLOCKED_OBSERVATION: Observation = {
  overlays: blocked,
  controls: blocked,
  layers: blocked,
  assertNoLeaks: blocked,
  notes: { readApi: "blocked" },
};

function observe(rawMap: unknown, container: HTMLElement, ready: MapReady): Observation {
  if (!rawMap) return BLOCKED_OBSERVATION;
  if (!descriptor.live) {
    const map = rawMap as { overlays: unknown[]; controls: unknown[]; layers: unknown[] };
    return {
      overlays: () => map.overlays.length,
      controls: () => map.controls.length,
      layers: () => map.layers.length,
      assertNoLeaks: () => descriptor.fake!.diagnostics.assertNoLeaks("jsapi-v4 browser smoke"),
      notes: { readApi: "fake-diagnostics" },
    };
  }

  const raw = rawMap as Record<string, unknown>;
  const readOr = (member: string): number | null => {
    const fn = raw[member];
    // 成员**不存在** → `null`，由探针如实记为「读数无法核对」（本引擎没有这个入口）；
    // 成员存在但返回值不是数组 → 显式失败。把这两种情况合成一个 `null` 会让
    // 「SDK 补了 getControls() 但 Driver 读错形状」永远不红（门禁空转）。
    if (typeof fn !== "function") return null;
    const value = (fn as () => unknown).call(raw);
    if (!Array.isArray(value)) {
      fail("SDK_READ_SHAPE", `map.${member}() 的返回值不是数组，读数无法核对`, {
        member,
        type: typeof value,
      });
    }
    return value.length;
  };
  const capabilities = ready.client.driver.capabilities as { supports(c: string): boolean };
  return {
    overlays: () => {
      const count = readOr("getOverlays");
      if (count === null) {
        fail(
          "SDK_NO_READ_API",
          "真实 v4 Map 缺少 getOverlays()，覆盖物读数无法核对（该成员是本库 v4 路径的既有前提）",
        );
      }
      return count;
    },
    controls: () => readOr("getControls"),
    layers: () => readOr("getLayers"),
    assertNoLeaks: () => {
      // 真实 SDK 只能核对两件**可观察**的事：
      //  ① 句柄已失效——`MapDriver` 契约要求 destroy 之后其它命令被拒绝（`BMAP_RESOURCE_DISPOSED`），
      //     这是「销毁路径真的跑过」的证据；
      //  ② SDK 在地图容器里搭的 DOM 已经撤掉（`.bmap-canvas-host` 是组件自己的宿主元素，
      //     不是 SDK 的产物，因此看它的**子节点**）。
      const canvasHost =
        (container.querySelector(".bmap-canvas-host") as HTMLElement | null) ?? container;
      assertSmoke(
        canvasHost.childElementCount === 0,
        "DOM_RESIDUE",
        "销毁地图后 SDK 的 map DOM 仍留在容器里",
        {
          canvasHostChildren: canvasHost.childElementCount,
          tags: [...canvasHost.children].map((el) => el.tagName),
          classes: [...canvasHost.children].map((el) => el.className),
        },
      );
      let disposed = false;
      let code: string | null = null;
      try {
        ready.client.driver.map.getZoom(ready.map);
      } catch (error) {
        disposed = true;
        code = (error as { code?: string }).code ?? null;
      }
      assertSmoke(
        disposed,
        "HANDLE_NOT_DISPOSED",
        "destroy 之后 getZoom 仍然成功：句柄没有被作废，销毁路径未生效",
        { code },
      );
      assertSmoke(
        code === "BMAP_RESOURCE_DISPOSED",
        "DISPOSE_CODE",
        `销毁后命令的错误码应为 BMAP_RESOURCE_DISPOSED，实际 ${String(code)}`,
        { code },
      );
      assertSmoke(capabilities.supports("overlay.marker"), "CAPABILITY", "v4 能力表缺少 overlay.marker");
    },
    notes: {
      readApi: {
        getOverlays: typeof raw.getOverlays === "function",
        getControls: typeof raw.getControls === "function",
        getLayers: typeof raw.getLayers === "function",
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 主流程                                                                      */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  descriptor = await setupMode();

  const plugin = createBMapPlugin(MODE === "live" ? { ak: AK } : {});
  const provider = plugin.config.provider as {
    id?: string;
    load(options: unknown, signal?: AbortSignal): Promise<{
      engine: string;
      version: string;
      namespace: unknown;
      load: { providerId: string; mode: string; versionSource: string; apiUrl: string; akRef: string };
    }>;
  };

  const run = new SmokeRun(MODE, {
    mode: MODE,
    userAgent: navigator.userAgent,
    hasAk: AK.length > 0,
    location: location.origin,
    webgl: Boolean(document.createElement("canvas").getContext("webgl2")),
  });

  /* ------------------------------------------------------------- 默认入口 */

  await run.probe("default-entry-provider", () => {
    assertSmoke(
      provider.id === "baidu-jsapi-v4",
      "DEFAULT_PROVIDER",
      `默认 Provider 不是 JSAPI 4.0 CDN 家族：${String(provider.id)}`,
      { providerId: provider.id },
    );
    assertSmoke(
      plugin.config.defaults.version === DEFAULT_VERSION,
      "DEFAULT_VERSION",
      `默认 version 不是 ${DEFAULT_VERSION}：${String(plugin.config.defaults.version)}`,
    );
    return { providerId: provider.id, version: plugin.config.defaults.version };
  });

  await run.probe("default-entry-load", async () => {
    const loaded = await withTimeout(
      provider.load(plugin.config.defaults),
      30_000,
      "默认 Provider 加载",
    );
    assertSmoke(loaded.engine === "jsapi-v4", "ENGINE", `加载结果 engine=${loaded.engine}`);
    assertSmoke(
      loaded.namespace === (globalThis as unknown as { BMap?: unknown }).BMap,
      "NAMESPACE",
      "默认入口没有以 globalThis.BMap 为命名空间",
      { namespaceMatches: false },
    );
    assertSmoke(
      loaded.load.akRef.startsWith("***") || loaded.load.akRef === "none",
      "AK_REDACTION",
      `metadata 里的 akRef 未脱敏：${loaded.load.akRef}`,
      { akRef: loaded.load.akRef },
    );
    if (descriptor.live) {
      // live：真正插入过 `v=4.0` 的 script，URL 就是证据
      assertSmoke(
        loaded.load.apiUrl.includes("v=4.0"),
        "ENTRY_VERSION",
        `入口 URL 未声明 v=4.0：${loaded.load.apiUrl}`,
        { apiUrl: loaded.load.apiUrl },
      );
      assertSmoke(
        !loaded.load.apiUrl.includes("type=webgl"),
        "ENTRY_WEBGL_PARAM",
        `入口 URL 仍带迁移期 type=webgl：${loaded.load.apiUrl}`,
        { apiUrl: loaded.load.apiUrl },
      );
    } else {
      // fixture：全局已由探针注入，默认入口命中「复用既有全局」分支，不会插入 script。
      // 「加载 v=4.0」这条断言改由 `default-entry-url` 用同一份 options 直接核对入口 URL。
      assertSmoke(
        loaded.load.mode === "existing-global",
        "ENTRY_MODE",
        `fixture 期望命中 existing-global 分支，实际 ${loaded.load.mode}`,
      );
    }
    return {
      providerId: loaded.load.providerId,
      loadMode: loaded.load.mode,
      version: loaded.version,
      versionSource: loaded.load.versionSource,
      apiUrl: loaded.load.apiUrl,
      akRef: loaded.load.akRef,
    };
  });

  if (!descriptor.live) {
    await run.probe("default-entry-url", () => {
      // 「所有默认入口加载 v=4.0」在 fixture 档无法靠真实 script 证明（不插 script），
      // 因此用默认入口**同一份 options** 走一遍入口 URL 构造。live 档由
      // `default-entry-load` 的 apiUrl 覆盖同一断言。
      const url = createBaiduSdkUrl(
        {
          ak: plugin.config.defaults.ak ?? "smoke-ak",
          apiUrl: plugin.config.defaults.apiUrl,
          version: plugin.config.defaults.version,
        },
        "__smoke_callback__",
      );
      const href = url.toString();
      assertSmoke(href.includes("v=4.0"), "ENTRY_VERSION", `入口 URL 未声明 v=4.0：${href}`, { href });
      assertSmoke(!href.includes("type=webgl"), "ENTRY_WEBGL_PARAM", `入口 URL 仍带 type=webgl：${href}`, {
        href,
      });
      return { href };
    });
  }

  await run.probe("reuse-existing-global", async () => {
    // 用**独立 registry**：同一进程级 `BMap` 域里已经登记了 `default-entry-load` 那次加载的
    // 指纹，指纹不同就按设计抛配置冲突（那是冲突域的正确行为，不是本探针要测的东西）。
    // 独立域下这里测的是纯粹的一条：页面已有 `globalThis.BMap` 时复用路径能否走通。
    const loaded = await withTimeout(
      existingGlobalV4Provider({ registry: new SdkRegistry({ domain: "BMap" }) }).load({}),
      15_000,
      "复用既有全局命名空间",
    );
    assertSmoke(
      loaded.load.mode === "existing-global",
      "REUSE_MODE",
      `复用路径的 load.mode=${loaded.load.mode}`,
    );
    assertSmoke(
      loaded.namespace === (globalThis as unknown as { BMap?: unknown }).BMap,
      "REUSE_NAMESPACE",
      "复用路径拿到的命名空间不是 globalThis.BMap",
    );
    const probed = (loaded.namespace as Record<string, unknown>).VERSION ?? null;
    return {
      version: loaded.version,
      versionSource: loaded.load.versionSource,
      /** 真实 4.0 全局自述的版本（已知会是 `gl`：入口的本体就是 WebGL 引擎） */
      globalVersionProbe: probed,
    };
  });

  if (descriptor.live) {
    await run.probe("sdk-constant-shape", () => {
      // 真实 4.0 的常量落点证据。`driver/jsapi-v4/map.ts` 的 `setMapType` 读
      // `BMap.MapTypeId.*`；这一条把「真实运行时到底有没有这个对象」钉成可核对的读数，
      // 而不是靠类型包里的声明推断（类型包声明 ≠ 运行时存在）。
      const global = globalThis as unknown as Record<string, unknown>;
      const namespace = global.BMap as Record<string, unknown> | undefined;
      const mapTypeId = namespace?.MapTypeId as Record<string, unknown> | undefined;
      const constants = [
        "BMAP_NORMAL_MAP",
        "BMAP_SATELLITE_MAP",
        "BMAP_HYBRID_MAP",
        "BMAP_EARTH_MAP",
        "BMAP_NONE_MAP",
      ];
      // 这里早于 <BMap> 挂载，拿不到 map 句柄；map 侧成员的存在性交给后续探针
      return {
        mapTypeIdObject: mapTypeId ? { ...mapTypeId } : null,
        // 官方类型包的注释推荐「直接使用 BMAP_*_MAP 全局常量」——这里把全局落点也钉下来
        globalConstants: Object.fromEntries(constants.map((name) => [name, global[name] ?? null])),
        namespaceConstants: Object.fromEntries(
          constants.map((name) => [name, namespace?.[name] ?? null]),
        ),
        versionKeys: {
          VERSION: namespace?.VERSION ?? null,
          version: namespace?.version ?? null,
        },
      };
    });
  }

  if (!descriptor.live) {
    await run.probe("fixture-network-isolation", () => {
      const external = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith(location.origin));
      assertSmoke(
        external.length === 0,
        "FIXTURE_NETWORK",
        "fixture 档出现了外部请求（PR 门禁必须无网络依赖）",
        { external },
      );
      return { externalRequests: external.length };
    });
  }

  /* ----------------------------------------------- Map / Overlay / Control / Layer */

  const mounted = mountMap(
    {
      children: () => [
        h(BMarker, { position: { ...CENTER } }),
        h(BPolyline, { path: [{ ...CENTER }, { ...POINT }], strokeColor: "#00ff00" }),
        h(BZoom),
        h(BPanoramaCoverageLayer),
      ],
    },
    plugin,
  );

  let ready: MapReady = BLOCKED_READY;
  await run.probe("map-ready", async () => {
    ready = await withTimeout(mounted.ready(), READY_MS, "<BMap> ready");
    assertSmoke(ready.client.engine === "jsapi-v4", "CLIENT_ENGINE", `client.engine=${ready.client.engine}`, {
      engine: ready.client.engine,
    });
    assertSmoke(ready.map, "MAP_HANDLE", "<BMap> ready 未带 map 句柄");
    return { engine: ready.client.engine, sdkVersion: ready.client.sdkVersion };
  });

  const container = mounted.host.firstElementChild as HTMLElement;
  // 前置失败时 `ready.map` 会抛 `BLOCKED`：这里不能让它逃出探针边界（否则整份报告都拿不到）
  const observation =
    ready === BLOCKED_READY
      ? BLOCKED_OBSERVATION
      : observe((ready.map as { raw?: unknown } | null)?.raw, container, ready);

  await run.probe("map-view-round-trip", () => {
    const map = ready.map;
    const center = ready.client.driver.map.getCenter(map);
    const zoom = ready.client.driver.map.getZoom(map);
    assertSmoke(
      Math.abs(center.lng - CENTER.lng) < 1e-3 && Math.abs(center.lat - CENTER.lat) < 1e-3,
      "VIEW_CENTER",
      `getCenter 回读与设定不一致：${JSON.stringify(center)}`,
      { center },
    );
    assertSmoke(zoom === 14, "VIEW_ZOOM", `getZoom 回读 ${zoom}，期望 14`);
    const pixel = ready.client.driver.map.pointToPixel(map, CENTER);
    const back = ready.client.driver.map.pixelToPoint(map, pixel);
    assertSmoke(
      Math.abs(back.lng - CENTER.lng) < 1e-3 && Math.abs(back.lat - CENTER.lat) < 1e-3,
      "VIEW_PROJECTION",
      `pointToPixel/pixelToPoint 不闭合：${JSON.stringify(pixel)} → ${JSON.stringify(back)}`,
      { pixel, back },
    );
    return { center, zoom, projectionClosed: true };
  });

  await run.probe("overlay-marker-polyline", () => {
    const count = observation.overlays();
    assertSmoke(
      count >= descriptor.minOverlays,
      "OVERLAY_COUNT",
      `覆盖物读数 ${count} < 期望下限 ${descriptor.minOverlays}`,
      { count, min: descriptor.minOverlays, ...observation.notes },
    );
    return { overlays: count, min: descriptor.minOverlays, ...observation.notes };
  });

  await run.probe("control-zoom", () => {
    const count = observation.controls();
    if (count === null) {
      // 真实 SDK 没有读取接口时如实登记「无法核对」，而不是当成通过（见 README 的读数表）
      return { readApi: "unavailable", note: "真实 v4 Map 未暴露 getControls()，控件读数无法核对" };
    }
    assertSmoke(count >= 1, "CONTROL_COUNT", `控件读数 ${count} < 1`, { count });
    return { controls: count };
  });

  await run.probe("layer-panorama-coverage", () => {
    const count = observation.layers();
    if (count === null) {
      return { readApi: "unavailable", note: "真实 v4 Map 未暴露 getLayers()，图层读数无法核对" };
    }
    assertSmoke(count >= 1, "LAYER_COUNT", `图层读数 ${count} < 1`, { count });
    return { layers: count };
  });

  await run.probe("overlay-infowindow-driver", async () => {
    // InfoWindow 在 v4 不是「普通覆盖物」：打开/关闭走地图级 API。这里验证 Driver 的
    // 这条路（创建 → 打开 → 回读 → **关闭 → 失活**），它才是组件将来要接的形态（#32）。
    const overlays = ready.client.driver.overlays as {
      createInfoWindow(content: HTMLElement, options?: Record<string, unknown>): unknown;
      openInfoWindow(map: unknown, infoWindow: unknown, position?: unknown): void;
      closeInfoWindow(infoWindow: unknown): void;
    };
    const shell = document.createElement("div");
    shell.textContent = "smoke infowindow";
    const infoWindow = overlays.createInfoWindow(shell, { title: "smoke" });
    overlays.openInfoWindow(ready.map, infoWindow, { ...CENTER });

    let opened: unknown = null;
    const deadline = Date.now() + (descriptor.live ? 5_000 : 0);
    do {
      opened = readOpenInfoWindow(ready.map);
      if (opened) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);

    const readApi = descriptor.live ? "map.getInfoWindow()" : "fake ledger";
    assertSmoke(opened !== null, "INFOWINDOW_OPEN", "openInfoWindow 之后没有回读到打开的气泡", {
      readApi,
    });
    // 回读到的必须**就是**刚打开的那个实例，否则「打开了」可能只是别处留下的气泡。
    // 注意比的是 raw SDK 对象：`createInfoWindow` 返回的是**句柄**（带品牌 symbol 的包装），
    // 而 `getInfoWindow()` / Fake 账本给出的都是 raw 实例。
    const rawInfoWindow = (infoWindow as { raw?: unknown }).raw ?? infoWindow;
    assertSmoke(
      opened === rawInfoWindow,
      "INFOWINDOW_IDENTITY",
      "回读到打开状态的气泡不是本次创建的实例",
      { readApi },
    );

    const overlaysAfterOpen = observation.overlays();
    overlays.closeInfoWindow(infoWindow);
    const closedRead = readOpenInfoWindow(ready.map);
    const overlaysAfterClose = observation.overlays();
    if (descriptor.live) {
      // 真实 SDK 上 `closeInfoWindow` 之后 `getInfoWindow()` 的口径没有可依赖的文档，
      // 因此只记录读数（见 detail），不把它写成断言；「关掉了」由组件 / 契约层负责。
      return { overlaysAfterOpen, overlaysAfterClose, closedReadIsNull: closedRead === null };
    }
    assertSmoke(closedRead === null, "INFOWINDOW_CLOSE", "closeInfoWindow 之后气泡仍处于打开状态", {
      readApi,
    });
    return { overlaysAfterOpen, overlaysAfterClose, closedReadIsNull: true };
  });

  await run.probe("infowindow-component-gap", () => {
    // **已知缺口，刻意不修**：`<BInfoWindow>` 的挂载路径仍把气泡当普通覆盖物
    // `overlays.add(map, iw)`，而 v4 OverlayDriver 明确拒绝这一用法（#21 的决策）。
    // 把它钉成可断言的现状，而不是从 smoke 里悄悄拿掉——否则「smoke 覆盖了 InfoWindow」
    // 会变成一句假话。重构属 M5（#32）。
    const overlays = ready.client.driver.overlays as {
      createInfoWindow(content: HTMLElement, options?: Record<string, unknown>): unknown;
      add(target: unknown, overlay: unknown): void;
    };
    const shell = document.createElement("div");
    const infoWindow = overlays.createInfoWindow(shell, {});
    let code: string | null = null;
    let message = "";
    try {
      overlays.add({ kind: "map", handle: ready.map }, infoWindow);
      fail("INFOWINDOW_ADD_ACCEPTED", "overlays.add 接受了 InfoWindow —— 契约已变化，请同步更新本探针与 ADR");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      code = (error as { code?: string }).code ?? null;
    }
    // 必须校验**具体原因码**：只断言「抛了错」的话，将来 add 因别的理由抛错（目标解析失败、
    // 能力不支持…）也会让这条探针继续绿，缺口被改变了却没人发现。
    assertSmoke(
      code === "BMAP_INVALID_ARGUMENT",
      "INFOWINDOW_ADD_CODE",
      `overlays.add 拒绝 InfoWindow 的原因码应为 BMAP_INVALID_ARGUMENT，实际 ${String(code)}`,
      { code, message },
    );
    return { rejected: true, code, message, trackedBy: "#32 (M5 重构 BInfoWindow)" };
  });

  if (descriptor.expectsTilesLoaded) {
    await run.probe("map-tiles-loaded", async () => {
      let tileEvents = 0;
      const off = ready.client.driver.events.on(ready.map, "tilesloaded", () => {
        tileEvents += 1;
      });
      try {
        const deadline = Date.now() + 20_000;
        while (tileEvents === 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      } finally {
        off();
      }
      assertSmoke(tileEvents > 0, "TILES_TIMEOUT", "20s 内没有收到 tilesloaded", { tileEvents });
      return { tileEvents };
    });
  } else {
    await run.probe("map-event-binding", () => {
      // 只比**增量**：此刻地图上已有 Driver 自己登记的监听器（销毁时要靠它们收尾），
      // 绝对值不为 0 是正常状态；「绑一次、解一次」必须回到同一数字才是断言。
      const before = descriptor.fake!.diagnostics.snapshot();
      const off = ready.client.driver.events.on(ready.map, "tilesloaded", () => {});
      const bound = descriptor.fake!.diagnostics.snapshot();
      off();
      const released = descriptor.fake!.diagnostics.snapshot();
      assertSmoke(
        bound.activity.listenCalls > before.activity.listenCalls,
        "EVENT_BIND",
        "driver.events.on 没有打到 SDK 的 addEventListener",
        { before: before.activity.listenCalls, bound: bound.activity.listenCalls },
      );
      assertSmoke(
        bound.leaks.listeners === before.leaks.listeners + 1,
        "EVENT_BIND_LEAK",
        `绑定后监听器数应为 ${before.leaks.listeners + 1}，实际 ${bound.leaks.listeners}`,
        { before: before.leaks.listeners, bound: bound.leaks.listeners },
      );
      assertSmoke(
        released.leaks.listeners === before.leaks.listeners,
        "EVENT_LEAK",
        `解绑后监听器数没有回到基线：${before.leaks.listeners} → ${released.leaks.listeners}`,
        { before: before.leaks.listeners, released: released.leaks.listeners },
      );
      return {
        listenCalls: bound.activity.listenCalls,
        listenersBefore: before.leaks.listeners,
        listenersAfterOff: released.leaks.listeners,
      };
    });
  }

  await run.probe("service-geocode", async () => {
    const services = ready.client.driver.services as {
      createGeocoder(): unknown;
      geocode(handle: unknown, request: { address: string; city?: string }): { result: Promise<unknown> };
    };
    const geocoder = services.createGeocoder();
    const result = (await withTimeout(
      services.geocode(geocoder, { address: ADDRESS, city: "北京市" }).result,
      descriptor.live ? 20_000 : 5_000,
      "geocode 结算",
    )) as { status: string; data: unknown; error: unknown };
    if (result.status !== "success") {
      // 真实环境的 `SERVICE_*` 码提示配额 / 网络（外部波动），与 `BMAP_*`（库回归）分开报
      const code = descriptor.live ? `SERVICE_${result.status.toUpperCase()}` : "SERVICE_FAILED";
      fail(code, `geocode 未命中结果：${result.status}`, { status: result.status, error: result.error });
    }
    return { status: result.status, data: result.data };
  });

  /* --------------------------------------------------------- 生命周期 */

  await run.probe("unmount-release", async () => {
    const beforeUnmount = descriptor.live ? null : descriptor.fake!.diagnostics.snapshot();
    await mounted.unmount();
    await new Promise((resolve) => setTimeout(resolve, descriptor.live ? 300 : 0));
    assertSmoke(mounted.unloaded === 1, "UNLOAD_EVENT", `unload 事件触发 ${mounted.unloaded} 次`);
    assertSmoke(
      mounted.errors.length === 0,
      "MAP_ERROR_EVENT",
      `<BMap> 广播了 error：${JSON.stringify(mounted.errors.map(String))}`,
      { errors: mounted.errors.map(String) },
    );
    // 卸载后才是「资源必须归零」的判定点：fixture 用精确诊断，live 用容器 DOM 清空
    observation.assertNoLeaks();
    return {
      unloadEvents: mounted.unloaded,
      hostChildren: mounted.host.childElementCount,
      leaksBeforeUnmount: beforeUnmount?.leaks ?? null,
    };
  });

  await run.probe("remount-after-unmount", async () => {
    const second = mountMap({ props: { center: { ...POINT } } }, plugin);
    try {
      const again = await withTimeout(
        second.ready(),
        READY_MS,
        "第二次 <BMap> ready",
      );
      assertSmoke(again.client.engine === "jsapi-v4", "REMOUNT_ENGINE", `remount engine=${again.client.engine}`);
      return { engine: again.client.engine, sdkVersion: again.client.sdkVersion };
    } finally {
      await second.unmount();
    }
  });

  await run.probe("multi-map", async () => {
    const host = document.createElement("div");
    host.style.display = "flex";
    document.body.appendChild(host);
    const createdBefore = descriptor.live ? 0 : descriptor.fake!.createdMaps.length;
    const readyCount: string[] = [];
    const app = createApp(
      defineComponent({
        name: "MultiMapRoot",
        render: () =>
          h("div", [
            h(BMap, {
              key: "a",
              center: { ...CENTER },
              zoom: 14,
              style: { width: "200px", height: "160px" },
              onReady: (payload: MapReady) => readyCount.push(payload.client.engine),
            }),
            h(BMap, {
              key: "b",
              center: { ...POINT },
              zoom: 12,
              style: { width: "200px", height: "160px" },
              onReady: (payload: MapReady) => readyCount.push(payload.client.engine),
            }),
          ]),
      }),
    );
    app.use(plugin);
    app.mount(host);
    try {
      const deadline = Date.now() + (READY_MS);
      while (readyCount.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assertSmoke(
        readyCount.length === 2,
        "MULTI_MAP",
        `同页两张 <BMap> 只有 ${readyCount.length} 张 ready`,
        { readyCount },
      );
      if (!descriptor.live) {
        // 只比增量：前面的阶段也创建过地图，`createdMaps` 是页面级累计账本
        const created = descriptor.fake!.createdMaps.length - createdBefore;
        assertSmoke(created === 2, "MULTI_MAP_FAKE", `Fake 只创建了 ${created} 张地图`, { created });
      }
      return { maps: readyCount.length, engines: readyCount };
    } finally {
      app.unmount();
      host.remove();
    }
  });

  await run.probe("plugin-failure-does-not-block-ready", async () => {
    // 插件在 ready **之后**后台加载；这里用一个必然失败的插件加载验证「不阻塞」。
    // fixture 档靠 runner 阻断外部请求让脚本加载失败（确定性地拿到 plugin-error）；
    // live 档脚本可达时拿到 plugin-ready——两个方向都算通过，但必须**结算**。
    const mountedWithPlugin = mountMap({ props: { plugins: ["TrackAnimation"] } }, plugin);
    try {
      const payload = await withTimeout(
        mountedWithPlugin.ready(),
        READY_MS,
        "带插件的地图 ready",
      );
      assertSmoke(payload.client.engine === "jsapi-v4", "PLUGIN_MAP_ENGINE", "带插件路径的 engine 不是 jsapi-v4");
      const deadline = Date.now() + (descriptor.live ? 20_000 : 8_000);
      while (
        mountedWithPlugin.pluginReady.length === 0 &&
        mountedWithPlugin.pluginError.length === 0 &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const settled =
        mountedWithPlugin.pluginReady.length + mountedWithPlugin.pluginError.length > 0;
      const entry = {
        ready: mountedWithPlugin.pluginReady,
        failed: mountedWithPlugin.pluginError.map((item) => item.name),
      };
      if (!descriptor.live) {
        assertSmoke(
          settled && mountedWithPlugin.pluginError.length === 1,
          "PLUGIN_ERROR_EXPECTED",
          "fixture 档阻断了外部请求，插件应当以 plugin-error 结算",
          entry,
        );
      } else {
        assertSmoke(settled, "PLUGIN_NOT_SETTLED", "插件既没有 ready 也没有 error", entry);
      }
      return entry;
    } finally {
      await mountedWithPlugin.unmount();
    }
  });

  await run.probe("retry-after-provider-failure", async () => {
    // 结构化 v4 Provider 首次失败、经 `<BMapProvider>` 的 error 插槽 `retry()` 后成功：
    // 走的是文档里承诺的那条重试通道，而不是「重新挂载」这种间接验证。
    let attempts = 0;
    const flaky = {
      id: "smoke-flaky-v4",
      getCacheKey: () => "smoke-flaky-v4",
      load: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("smoke: 首次加载失败");
        return provider.load(plugin.config.defaults);
      },
    };

    const host = document.createElement("div");
    document.body.appendChild(host);
    const captured: { retry?: () => Promise<unknown> } = {};
    const readyClients: MapReady[] = [];
    const failures: unknown[] = [];

    const app = createApp(
      defineComponent({
        name: "RetryRoot",
        render: () =>
          h(
            BMapProvider,
            {
              provider: flaky as never,
              onReady: (client: MapReady) => readyClients.push(client),
              onError: (error: unknown) => failures.push(error),
            },
            {
              // `status === 'error'` 时渲染 error 插槽；retry 从插槽参数取得
              error: (slot: { retry: () => Promise<unknown> }) => {
                captured.retry = slot.retry;
                return h("div", { class: "smoke-retry-slot" });
              },
              default: () => h("div"),
            },
          ),
      }),
    );
    app.use(plugin);
    app.mount(host);
    try {
      const deadline = Date.now() + (READY_MS);
      while (!captured.retry && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assertSmoke(failures.length >= 1, "RETRY_FIRST_FAIL", "首次加载没有按预期失败");
      assertSmoke(Boolean(captured.retry), "RETRY_SLOT", "error 插槽没有给出 retry");
      await captured.retry!();
      await nextTick();
      assertSmoke(readyClients.length >= 1, "RETRY_READY", "retry 之后没有 ready");
      assertSmoke(attempts >= 2, "RETRY_ATTEMPTS", `Provider 只被调用 ${attempts} 次`);
      return { attempts, engine: readyClients[0]?.engine ?? null };
    } finally {
      app.unmount();
      host.remove();
    }
  });

  const report = run.report(unhandled);
  window.__SMOKE__ = report;
  const out = document.getElementById("out");
  if (out) out.textContent = formatReport(report);
  document.documentElement.setAttribute("data-smoke", report.ok ? "done" : "failed");
}

main().catch((error: unknown) => {
  const report: SmokeReport = {
    mode: MODE,
    ok: false,
    okCount: 0,
    failCount: 1,
    probes: [
      {
        name: "harness",
        ok: false,
        code: "HARNESS_CRASH",
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        durationMs: 0,
      },
    ],
    unhandled: unhandled.filter((entry) => !entry.thirdParty),
    thirdPartyUnhandled: unhandled.filter((entry) => entry.thirdParty),
    env: {},
    durationMs: 0,
    finishedAt: new Date().toISOString(),
  };
  window.__SMOKE__ = report;
  const out = document.getElementById("out");
  if (out) out.textContent = formatReport(report);
  document.documentElement.setAttribute("data-smoke", "failed");
});
