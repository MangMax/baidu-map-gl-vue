/**
 * Driver matrix（M3A3-FAKE-DUAL / issue #24）
 *
 * 迁移期的核心疑问是：**同一份组件代码在旧 Driver（webgl-v1）与 v4 Driver 上是否给出同样的
 * 领域结果**——而不是「raw SDK 调用序列是否逐条相同」。后者没有意义（两个引擎的方法名、
 * 图层分发、常量表示本来就不同，见 `driver-contract.ts` 的模块注释）。
 *
 * 因此这里只做三件事，其余留给用例：
 *
 * 1. `runDriverMatrix(engines, scenario)`：在每个引擎上**各跑一次**同一份领域场景，每个引擎一份
 *    全新的 Provider / 容器（互不共享 client 与句柄），返回 `engine → 结果`；
 * 2. `expectSameDomainResult(results, engines)`：跨引擎比较结果，不一致时逐字段点名；
 * 3. `createJsapiV4MatrixEngine()` / `createLegacyMatrixEngine()`：两个引擎的**具体描述**
 *    （Provider / 容器 / 基线重置 / 泄漏门禁 / 挂载计数）。
 *
 * 「引擎差异」全部收在第 3 项里：用例只与 `engine` 名和一个统一的领域场景打交道，
 * 不需要知道 v4 的图层记在 `map.layers`、而 BMapGL 的图层混在 `map.overlays`。
 *
 * 双跑只用于验证，不形成长期兼容承诺（issue #24「目标与范围」）：`#26` 删掉 webgl-v1 之后，
 * 本文件与 legacy 引擎描述一并删除，`runDriverMatrix` 对单引擎仍然可用。
 */
import { expect } from "vitest";
import type { AnyBMapProviderLike, BMapClient } from "../baidu-map-gl-vue/src/client/types";
import { createBMapClient } from "../baidu-map-gl-vue/src/client/createBMapClient";
import type { UnsupportedBehavior } from "../baidu-map-gl-vue/src/driver/capability/unsupported";
import type { BMapEngine } from "../baidu-map-gl-vue/src/driver/types/bmap";
import { createLoadedJsapiV4 } from "../baidu-map-gl-vue/src/core/loader/providers";
import { createFakeBMapV4, type FakeBMapV4 } from "./fake-bmap-v4/index.ts";
import { getFakeBMapGl, resetLifecycleState } from "./lifecycle-inspector/index.ts";

/** 组件挂在 Map 上的子资源种类（各引擎的假账本位置不同，见引擎描述）。 */
export type DriverMatrixResourceKind = "overlay" | "control" | "layer";

export interface DriverMatrixEngine {
  readonly engine: BMapEngine;
  /**
   * 组件路径的 Provider。
   *
   * 用**宽松**形状（`{ load }`）而不是结构化 `LoadedSdk`，是因为组件内部本来就经
   * `withMigrationDriver()` 归一——v4 Provider 必须自述 `engine`（裸命名空间会被当成
   * v2/v3-beta 全局），legacy 则只能给出裸值，这个差异收在各引擎描述里。
   */
  provider(): AnyBMapProviderLike;
  /** 每个用例一份的挂载容器（已 attach 到 document 并带内联尺寸）。 */
  container(): HTMLElement;
  /** 用例开头重置该引擎 Fake 的生命周期基线。 */
  reset(): void;
  /**
   * 断言「当前没有任何未释放的 SDK 侧资源」。
   *
   * 各引擎用自己的 Fake 诊断实现（v4：`FakeV4Diagnostics.assertNoLeaks()`；webgl-v1：由
   * `mapsCreated - mapsDestroyed` / `overlaysCreated - overlaysRemoved` /
   * `controlsCreated - controlsRemoved` / listener 差推导）。用例只写 `ctx.assertIdle()`，
   * 不碰字段名——这也是「诊断计数可用于生命周期门禁」在跨引擎层面的形态。
   */
  assertIdle(): void;
  /**
   * 当前挂在**最后一张创建的 Map** 上的子资源数。
   *
   * 契约里同样把假账本放在 harness 一侧（见 `driver-contract.ts` 的 `MountFacetHarness`）：
   * v4 的图层进 `map.layers`，BMapGL 没有统一 `addLayer`、图层混在 `map.overlays`——
   * 「挂上了 1 个」这个领域事实两边都成立，读法由引擎描述吸收。
   */
  attached(kind: DriverMatrixResourceKind): number;
  /**
   * 最后一张地图上挂载的**覆盖物位置**（不含图层），按挂载顺序；无位置的覆盖物记为 `null`。
   *
   * 覆盖物组件的领域结果就是「SDK 上有一个位于 X 的覆盖物」，位置是唯一能跨引擎比较的取值
   * （不比较实例身份，也不比较 SDK 方法调用序列）。
   */
  overlayPositions(): Array<{ lng: number; lat: number } | null>;
  /** 最后一张地图上当前打开的气泡数（BMapGL 允许多个共存，v4 同一张图只有一个）。 */
  openInfoWindows(): number;
}

export interface DriverMatrixContext {
  readonly engine: BMapEngine;
  readonly provider: AnyBMapProviderLike;
  readonly container: HTMLElement;
  /** 断言该引擎当前无未释放资源。 */
  assertIdle(): void;
  /** 该引擎最后一张 Map 上挂着的子资源数。 */
  attached(kind: DriverMatrixResourceKind): number;
  /** 该引擎最后一张 Map 上挂载的覆盖物位置（按挂载顺序）。 */
  overlayPositions(): Array<{ lng: number; lat: number } | null>;
  /** 该引擎最后一张 Map 上当前打开的气泡数。 */
  openInfoWindows(): number;
}

function sizedContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.width = "320px";
  el.style.height = "240px";
  document.body.appendChild(el);
  return el;
}

/** 取「最后一张创建的 Map」：矩阵的所有挂载读数都以它为准（用例必须先过 `<BMap>`）。 */
function lastCreatedMap<T>(maps: readonly T[], label: string): T {
  const map = maps[maps.length - 1];
  if (!map) throw new Error(`${label}：矩阵用例必须先创建地图（BMap 组件）`);
  return map;
}

/** 覆盖物位置投影：两个引擎的 Fake 都用「实例上的 `position` 字段」表达位置。 */
function toPositions(overlays: Iterable<unknown>): Array<{ lng: number; lat: number } | null> {
  return [...overlays].map((overlay) => {
    const position = (overlay as { position?: { lng: number; lat: number } }).position;
    return position ? { lng: position.lng, lat: position.lat } : null;
  });
}

/**
 * 在每个引擎上跑一遍同一份领域场景，返回 `engine → 结果`。
 *
 * 每个引擎跑之前都会 `reset()` 基线、给一份新容器；场景内部自己决定何时卸载与断言。
 */
export async function runDriverMatrix<Result>(
  engines: readonly DriverMatrixEngine[],
  scenario: (ctx: DriverMatrixContext) => Promise<Result> | Result,
): Promise<Record<string, Result>> {
  const results: Record<string, Result> = {};
  for (const engine of engines) {
    engine.reset();
    const context: DriverMatrixContext = {
      engine: engine.engine,
      provider: engine.provider(),
      container: engine.container(),
      assertIdle: () => engine.assertIdle(),
      attached: (kind) => engine.attached(kind),
      overlayPositions: () => engine.overlayPositions(),
      openInfoWindows: () => engine.openInfoWindows(),
    };
    try {
      results[engine.engine] = await scenario(context);
    } finally {
      context.container.remove();
    }
  }
  return results;
}

/** 递归收集两个领域结果的差异路径（用于把「不一致」说到具体字段）。 */
function diffPaths(a: unknown, b: unknown, path = "$"): string[] {
  if (Object.is(a, b)) return [];
  if (typeof a !== typeof b || a === null || b === null) return [path];
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return [path];
    if (a.length !== b.length) return [`${path}.length`];
    return a.flatMap((item, index) => diffPaths(item, b[index], `${path}[${index}]`));
  }
  if (typeof a !== "object" || typeof b !== "object") return [path];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((key) =>
    diffPaths(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      `${path}.${key}`,
    ),
  );
}

/**
 * 跨引擎比较领域结果。
 *
 * 用 `diffPaths` 先定位差异再断言：直接 `expect(b).toEqual(a)` 在多层对象上只会给出一大坨
 * diff，而「哪个字段不一致」才是判断「组件依赖了某个引擎」的线索。
 */
export function expectSameDomainResult(
  results: Record<string, unknown>,
  engines: readonly DriverMatrixEngine[],
  label = "领域结果",
): void {
  // 少于两个引擎就没有「跨引擎比较」可言：静默跳过会让调用方以为比对过了（门禁空转），
  // 单引擎场景请直接断言结果本身
  if (engines.length < 2) {
    throw new Error(
      `${label}：跨引擎比较至少需要两个引擎，收到 ${engines.length} 个（单引擎请直接断言结果）`,
    );
  }
  const [baselineEngine, ...others] = engines;
  const baseline = results[baselineEngine!.engine];
  for (const engine of others) {
    const actual = results[engine.engine];
    const diff = diffPaths(actual, baseline);
    expect(
      diff,
      `${label}：${engine.engine} 与 ${baselineEngine.engine} 在这些字段上不一致`,
    ).toEqual([]);
    expect(actual, `${label}：${engine.engine} 与 ${baselineEngine.engine}`).toEqual(baseline);
  }
}

/* -------------------------------------------------------------------------- */
/* 引擎描述（差异集中在这里）                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 用 Fake v4 装出**默认路径**的 v4 Client：结构化 Provider + `createBMapClient`。
 *
 * 刻意不走 `createJsapiV4Driver` 直连：契约要验证的是组件默认路径真的会拿到的那条链
 * （Provider 归一 → `assertLoadedJsapiV4` → 默认 Driver 工厂 → Client 组装），
 * 少一环就可能放过「Provider 归一坏了但 Driver 本身没问题」这类回归。
 */
export async function createFakeV4Client(
  fake: FakeBMapV4 = createFakeBMapV4(),
  options: { unsupported?: UnsupportedBehavior } = {},
): Promise<{ client: BMapClient; fake: FakeBMapV4 }> {
  const client = await createBMapClient({
    provider: {
      id: "fake-bmap-v4",
      getCacheKey: () => "fake-bmap-v4",
      load: async () =>
        createLoadedJsapiV4({
          providerId: "custom-script-v4",
          mode: "jsonp",
          version: fake.namespace.VERSION,
          versionSource: "url",
          options: { ak: "fake-ak" },
          fingerprint: "fake-bmap-v4",
          namespace: fake.namespace,
          loadedAt: 0,
        }),
    },
    loadOptions: { ak: "fake-ak" },
    unsupported: options.unsupported ?? "warn",
  });
  return { client, fake };
}

/** v4 引擎：Fake `BMap` v4 + Fake 诊断门禁。 */
export function createJsapiV4MatrixEngine(fake: FakeBMapV4 = createFakeBMapV4()): {
  engine: DriverMatrixEngine;
  fake: FakeBMapV4;
} {
  const lastMap = () => lastCreatedMap(fake.createdMaps, "jsapi-v4 matrix");
  return {
    fake,
    engine: {
      engine: "jsapi-v4",
      provider: () => ({
        // v4 Provider 必须自述 engine：裸命名空间在结构上与 webgl-v1 无法区分，
        // 会被迁移期归一当成 legacy（见 client/migration.ts 的注释）
        load: async () => ({ engine: "jsapi-v4", version: fake.namespace.VERSION, namespace: fake.namespace }),
      }),
      container: sizedContainer,
      reset: () => {
        fake.diagnostics.reset();
        // 卸下的运行时注入成员必须装回：否则一个忘了恢复的用例会把「命名空间缺成员」
        // 带进后续用例，而那类失败会伪装成「Driver 探测错了」
        fake.runtimeExtensions.restoreAll();
      },
      assertIdle: () => {
        fake.diagnostics.assertNoLeaks("jsapi-v4 matrix");
      },
      attached: (kind) => {
        const map = lastMap();
        if (kind === "overlay") return map.overlays.length;
        if (kind === "control") return map.controls.length;
        return map.layers.length;
      },
      overlayPositions: () => toPositions(lastMap().overlays),
      openInfoWindows: () => (lastMap().infoWindow ? 1 : 0),
    },
  };
}

/**
 * legacy 引擎：Fake BMapGL（模块级单例，与 `tests/setup.ts` 注入 `window.BMapGL` 的那份一致）。
 */
export function createLegacyMatrixEngine(): DriverMatrixEngine {
  const fake = getFakeBMapGl();
  const lastMap = () => lastCreatedMap(fake.createdMaps, "webgl-v1 matrix");
  return {
    engine: "webgl-v1",
    provider: () => ({
      // 宽松 Provider：组件的迁移期归一按 engine 分派（裸值 → webgl-v1）
      load: async () => {
        (window as unknown as { BMapGL: unknown }).BMapGL = fake;
        return fake;
      },
    }),
    container: sizedContainer,
    reset: () => {
      resetLifecycleState();
      fake.stats.reset();
      fake.createdMaps.length = 0;
      fake.createdContextMenus.length = 0;
    },
    assertIdle: () => {
      // BMapGL 的 Fake 没有统一诊断对象，门禁就在这里按它的统计口径表达（见引擎描述注释）
      const leaked = {
        maps: fake.stats.mapsCreated - fake.stats.mapsDestroyed,
        overlays: fake.stats.overlaysCreated - fake.stats.overlaysRemoved,
        controls: fake.stats.controlsCreated - fake.stats.controlsRemoved,
        listeners: fake.stats.listeners,
      };
      const entries = Object.entries(leaked).filter(([, value]) => value !== 0);
      if (entries.length > 0) {
        throw new Error(
          `[webgl-v1 matrix] 资源未释放: ${entries.map(([key, value]) => `${key}=${value}`).join(", ")}`,
        );
      }
    },
    attached: (kind) => {
      const map = lastMap();
      // BMapGL 没有 4.0 的统一 `addLayer`：DistrictLayer / TileLayer 走
      // `addDistrictLayer` / `addTileLayer`，落进 `overlays` 容器（同 v3-driver-contract 的读法）
      if (kind === "control") return map.controls.size;
      return map.overlays.size;
    },
    overlayPositions: () => toPositions(lastMap().overlays),
    openInfoWindows: () =>
      // 注意不能读 `map.openInfoWindows.size`：旧 Driver 的 close 走 SDK 的 `hide()`
      // （见 `driver/webgl-v1/overlays.ts`），FakeMap 里的那个 Set 是「曾经打开过」而不是
      // 「现在还开着」。以 SDK 对象自己的 `isOpen()` 为准，才是两边同义的活状态。
      [...lastMap().openInfoWindows].filter(
        (infoWindow) =>
          (infoWindow as { isOpen?: () => boolean }).isOpen?.() !== false,
      ).length,
  };
}

/** 默认矩阵：v4 + 迁移期 legacy。 */
export function createMigrationMatrixEngines(): {
  engines: DriverMatrixEngine[];
  fakeV4: FakeBMapV4;
} {
  const { engine, fake } = createJsapiV4MatrixEngine();
  return { engines: [engine, createLegacyMatrixEngine()], fakeV4: fake };
}
