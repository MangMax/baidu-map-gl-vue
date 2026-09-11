/**
 * v4 LayerDriver（M3A2-CONTROLS-LAYERS / issue #22）
 *
 * 把 JSAPI 4.0 的图层收敛成项目领域映射（`LayerDriver`）；公共 API 不新增成员，
 * 只把 `LayerHandle` 已有的品牌口径（`layer:<kind>`）落实。
 *
 * 行为依据（官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.4` + 官方 Skill
 * `references/tile-and-service-layers.md` / `administrative-district.md`）：
 * - 4.0 用**统一**入口 `map.addLayer/removeLayer` 管理所有图层，按图层原型的家族标志位
 *   （`isDistrictLayer` / `isTileLayer`）内部分发；`addDistrictLayer` / `addTileLayer` 已
 *   标记 `@deprecated`，因此这里一律走统一入口（webgl-v1 的 `addDistrictLayer` 是迁移期
 *   行为，随 #26 删除）；
 * - `DistrictLayer` 的构造选项在 4.0 的**官方声明**里是 `autoViewport`（项目侧历史上叫
 *   `viewport`）。真实 AK smoke（ADR「真实 AK smoke 记录」）实测：4.0 运行时**同时接受**
 *   `viewport` 与 `autoViewport`（负对照 `autoViewport: false` 与不给该选项都不动视野，
 *   给了才动），所以这里不是修一个「静默失效」。做**显式改名**的理由是 issue #22 的风险条目：
 *   不依赖未在官方类型/文档里声明的别名——别名一旦在升级中消失，表现会是「view 静默不取景」；
 * - `DistrictLayer` **没有字段级 setter**（`strokeColor` / `fillColor` 等全是构造选项），
 *   所以它的 option 更新归入「构造期」：`setOptions` 告警一次并把重建决定交给调用方；
 * - `TileLayer` 的 option 里只有 `zIndex` 有 setter；
 * - `PanoramaCoverageLayer` 在 4.0.4 类型包里**没有类声明**（官方 Skill 明确它是 4.0 公开
 *   图层），只能按结构探测：有就创建，没有就告警一次并显式失败（不静默降级）。
 */
import { BMapError } from "../../core/errors/BMapError";
import type { Capability } from "../capability/catalog";
import type { CapabilityRegistry } from "../capability/registry";
import { HANDLE_BRAND, type LayerHandle } from "../types/handles";
import type { LayerDriver, LayerKind } from "../types/layers";
import {
  assertJsapiV4Namespace,
  callRequired,
  createMapTargetResolver,
  createMountTracker,
  createWarnOnce,
  namespaceCtor,
  readNamespaceMember,
  requireRuntimeCtor,
  sdkCall,
  type JsapiV4Ctor,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4HandleRegistry } from "./registry";

/**
 * 每种图层的完整描述符（构造器名 + 是否被官方类型包声明 + option 更新口径）。
 *
 * 三件事写在**同一条**记录里，是为了让它们不能互相漂移：
 * - `ctor`：4.0 构造器名（文件末尾的断言把它钉在官方 `BMap` 命名空间上）；
 * - `declared`：`@baidumap/jsapi-v4-types@4.0.4` 是否声明了该类。`false` 的 kind 只能按结构
 *   探测构造器（缺成员时报 `BMAP_CAPABILITY_UNSUPPORTED`），**且**它的 option 没有可核对的
 *   声明，未命中键走结构逃生口而不是「构造期」告警——两条都是从同一个事实派生的；
 * - `mutable` / `aliases`：可以就地更新的 option 与领域名到 4.0 选项名的改名。
 */
interface LayerDescriptor {
  ctor: string;
  declared: boolean;
  mutable: LayerMutableOptions;
  aliases: Readonly<Record<string, string>>;
}

/** 有字段级 setter 的 option（值型）：键 → setter 名。 */
type LayerMutableOptions = Readonly<Record<string, string>>;

/**
 * 图层 option 的更新口径（「动态 option 与必须重建的 option」的分类，issue #22 实施步骤 3）。
 *
 * 表用 `Record<LayerKind, …>`：新增一个图层种类却忘记写分类会直接编译失败。
 */
const LAYER_DESCRIPTORS = {
  district: {
    ctor: "DistrictLayer",
    declared: true,
    // 4.0 的 DistrictLayer 只有构造选项（strokeColor / fillColor / kind / …），没有 setter
    mutable: {},
    aliases: { viewport: "autoViewport" },
  },
  "panorama-coverage": {
    ctor: "PanoramaCoverageLayer",
    declared: false,
    mutable: {},
    aliases: {},
  },
  tile: {
    ctor: "TileLayer",
    declared: true,
    mutable: { zIndex: "setZIndex" },
    aliases: {},
  },
} as const satisfies Record<LayerKind, LayerDescriptor>;

/** 每种图层对应的语义能力（能力清单是单一事实源：`driver/capability/catalog.ts`）。 */
const LAYER_CAPABILITIES: Readonly<Partial<Record<LayerKind, Capability>>> = {
  district: "layer.district",
  "panorama-coverage": "layer.panorama-coverage",
  tile: "layer.tile",
};

export interface CreateJsapiV4LayerDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
}

export function createJsapiV4LayerDriver(input: CreateJsapiV4LayerDriverInput): LayerDriver {
  const { rawSdk, capabilities, registry } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);

  /** 已告警过的「分类 / 键 / 种类」组合：每个 Driver 一份，避免重复刷屏。 */
  const warnOnce = createWarnOnce();
  /**
   * 已挂到某张地图上的图层。
   *
   * 与控件同理：不把「4.0 的 `addLayer` 会不会去重」当成可以依赖的行为，Driver 自己记账，
   * 保证「重复 add 只挂一次」这条不变式（真实 SDK 上的实际行为由 M3A.3 的 smoke 核对）。
   */
  const mounted = createMountTracker();
  /** 图层只能挂到 Map；其它 target 在本引擎没有运行时入口，必须显式失败。 */
  const requireMapTarget = createMapTargetResolver({
    facet: "LayerDriver",
    entry: "map.addLayer / removeLayer",
    resolve: (handle) => registry.resolve<object>(handle),
    warn: warnOnce,
  });

  /** 图层句柄种类：品牌即 `layer:<kind>`（纯元数据，所有权校验留给 `registry.resolve`）。 */
  const kindOfLayer = (layer: LayerHandle): LayerKind | undefined => {
    const match = /^layer:(.+)$/.exec(String(layer[HANDLE_BRAND]));
    return match?.[1] as LayerKind | undefined;
  };

  /**
   * 领域 options → 4.0 构造 options。
   *
   * 只做**改名**（`viewport` → `autoViewport`），不做键的过滤：项目 option 接口是
   * `Record<string, unknown>`，索引签名就是「4.0 自身构造选项」的逃生口
   * （`DistrictLayer` 的 `adcode` / `onComplete`、`TileLayer` 的 `tileUrlTemplate` 等）。
   * 别名键与目标键**同时出现**时以显式写下的 v4 键为准（不因为历史名字覆盖新名字）。
   *
   * 注：真实 4.0 运行时目前也接受 `viewport`（smoke 实测），所以改名不是「修静默失效」，
   * 而是不把未声明的别名当成契约（见文件头的依据说明）。
   */
  const projectOptions = (
    kind: LayerKind,
    options: Record<string, unknown> | undefined,
  ): Record<string, unknown> => {
    // 取宽类型视图（`as const` 让表里的键保持字面量，但索引需要 `Record<string, string>`）
    const { aliases }: LayerDescriptor = LAYER_DESCRIPTORS[kind];
    const source = options ?? {};
    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      const target = aliases[key];
      if (target && target in source) continue;
      projected[target ?? key] = value;
    }
    return projected;
  };

  const ctorFor = (kind: LayerKind, ctorName: string): JsapiV4Ctor => {
    if (LAYER_DESCRIPTORS[kind].declared) return namespaceCtor(namespace, ctorName);
    return requireRuntimeCtor(namespace, ctorName, (message) =>
      warnOnce(
        `${kind}:no-runtime-entry`,
        `LayerDriver: ${message}；"${kind}" 无法创建（本仓库的该图层入口依赖 4.0 运行时提供它）`,
      ),
    );
  };

  return {
    create(kind: LayerKind, options: Record<string, unknown> = {}): LayerHandle {
      const descriptor = LAYER_DESCRIPTORS[kind] as LayerDescriptor | undefined;
      if (!descriptor) {
        throw new BMapError("BMAP_INVALID_ARGUMENT", `未知图层种类: ${String(kind)}`, {
          engine: "jsapi-v4",
        });
      }
      const ctorName = descriptor.ctor;
      // 能力守卫先于构造：在 `unsupported: "throw"` 策略下不会产生「创建好但没人用」的实例。
      // `warn` / `silent` 策略下按设计继续构造——策略本身是调用方的选择（见 ADR §11）。
      const capability = LAYER_CAPABILITIES[kind];
      if (capability) capabilities.require(capability);
      const Ctor = ctorFor(kind, ctorName);
      const opts = projectOptions(kind, options);
      const raw = sdkCall(ctorName, () => new Ctor(opts));
      return registry.adopt(`layer:${kind}`, raw);
    },

    add(target, layer) {
      const rawMap = requireMapTarget(target, "add");
      const raw = registry.resolve<object>(layer);
      if (!mounted.claim(rawMap, raw)) return;
      // 统一入口：4.0 的 addDistrictLayer / addTileLayer 已 deprecated
      sdkCall("map.addLayer", () => callRequired(rawMap, "addLayer", raw));
    },

    remove(target, layer) {
      const rawMap = requireMapTarget(target, "remove");
      const raw = registry.resolve<object>(layer);
      sdkCall("map.removeLayer", () => callRequired(rawMap, "removeLayer", raw));
      mounted.release(rawMap, raw);
    },

    setOptions(layer, options) {
      const raw = registry.resolve<Record<string, unknown>>(layer);
      const kind = kindOfLayer(layer);
      const descriptor: LayerDescriptor | undefined = kind ? LAYER_DESCRIPTORS[kind] : undefined;

      for (const [key, value] of Object.entries(options)) {
        if (value === undefined) continue;
        const method = descriptor?.mutable[key];
        if (method) {
          if (typeof readNamespaceMember(raw, method) !== "function") {
            warnOnce(
              `missing:${kind}:${method}`,
              `LayerDriver.setOptions: ${kind}.${key} 声明为可就地更新（${method}），但当前实例没有该方法，` +
                "本次更新被忽略",
            );
            continue;
          }
          callRequired(raw, method, value);
          continue;
        }
        if (descriptor?.declared) {
          warnOnce(
            `recreate:${kind}:${key}`,
            `LayerDriver.setOptions: ${kind}.${key} 只有构造期生效（4.0 的 ${kind} 图层没有该字段的 ` +
              "setter）；本次更新被忽略，需要生效请重建图层",
          );
          continue;
        }
        // 逃生口：类没有可核对的声明（运行时扩展类），按 `set<Key>` 结构调用并探测
        const setter = `set${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        if (typeof readNamespaceMember(raw, setter) !== "function") {
          warnOnce(
            `unknown:${kind}:${key}`,
            `LayerDriver.setOptions: ${kind} 没有 "${key}" 的字段级 setter（也不在图层 option 分类里），` +
              "本次更新被忽略",
          );
          continue;
        }
        callRequired(raw, setter, value);
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 官方类型一致性（类型层断言，零运行时开销）                                     */
/* -------------------------------------------------------------------------- */

type ExpectTrue<T extends true> = T;

/**
 * 类型包**已声明**类声明的图层构造器名必须与官方 `BMap` 命名空间一致。
 *
 * 「哪些 kind 被声明」直接从 `LAYER_DESCRIPTORS[*].declared` 派生（`as const satisfies` 让
 * `declared` 保持字面量），因此**表与断言不可能漂移**：把 `panorama-coverage` 的 `declared`
 * 改成 `true`（或反过来）都会连同运行时策略一起生效。
 *
 * `PanoramaCoverageLayer` 之所以 `declared: false`：它不在
 * `@baidumap/jsapi-v4-types@4.0.4` 的声明里（官方 Skill 明确它是 4.0 公开图层，属运行时能力），
 * 存在性只能由 `requireRuntimeCtor` 在运行时按结构判断；上游补齐声明后把 `declared` 改成
 * `true`，这条断言会立刻校验它的构造器名。
 */
type DeclaredLayerKind = {
  [K in LayerKind]: (typeof LAYER_DESCRIPTORS)[K]["declared"] extends true ? K : never;
}[LayerKind];
type _AssertDeclaredLayerCtors = ExpectTrue<
  (typeof LAYER_DESCRIPTORS)[DeclaredLayerKind]["ctor"] extends keyof typeof BMap ? true : false
>;
