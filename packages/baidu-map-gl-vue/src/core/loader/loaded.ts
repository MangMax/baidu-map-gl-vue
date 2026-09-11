/**
 * SDK 加载结果（结构化契约）
 *
 * M3A1-CLIENT（issue #18）：Client 不再接收裸 SDK `unknown` 作为公共加载结果。
 * Provider 必须返回**结构化**的 `LoadedSdk`，并按 `engine` 判别：
 *
 * - `LoadedJsapiV4`：Stable 基线（JSAPI 4.0），携带 engine / version / namespace / load metadata；
 * - `LoadedLegacySdk`：迁移期 webgl-v1 过渡实现，只携带命名空间——版本由 Driver 在创建时
 *   探测（见 `driver/webgl-v1/createDriver.ts` 的 `detectVersion`），Loader 不代为声明。
 *
 * `namespace` 是 raw SDK 逃生口，只允许 Driver / Client 边界读取，组件与 Composable 不得直接访问。
 */
import { BMapError } from "../errors/BMapError";
import type { LoadedJsapiV4 } from "./providers/types";

export type { LoadedJsapiV4 };

/** 迁移期 legacy 加载结果。 */
export interface LoadedLegacySdk {
  readonly engine: "webgl-v1";
  /** raw SDK 命名空间（逃生口）。 */
  readonly namespace: unknown;
}

export type LoadedSdk = LoadedJsapiV4 | LoadedLegacySdk;

/** 唯一的 legacy 结果构造点：所有迁移期路径都经此产生 `LoadedLegacySdk`。 */
export function loadedLegacySdk(namespace: unknown): LoadedLegacySdk {
  return { engine: "webgl-v1", namespace };
}

/**
 * 判别字段探测：只认 `engine`，不要求 `namespace`。
 *
 * 残缺的结构化结果（有 engine、无 namespace）也必须能被识别，否则会被宽松 legacy
 * 归一误当成裸全局而静默接受——那正是「jsapi-v4 结果被当成 webgl-v1」的失败模式。
 */
export function readLoadedEngine(value: unknown): LoadedSdk["engine"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const engine = (value as { engine?: unknown }).engine;
  return engine === "jsapi-v4" || engine === "webgl-v1" ? engine : undefined;
}

/** 完整结构化加载结果的判别：`engine` + `namespace` 齐备。 */
export function isLoadedSdk(value: unknown): value is LoadedSdk {
  return readLoadedEngine(value) !== undefined && "namespace" in (value as object);
}

export function isLoadedJsapiV4(value: LoadedSdk): value is LoadedJsapiV4 {
  return value.engine === "jsapi-v4";
}

export function isLoadedLegacySdk(value: LoadedSdk): value is LoadedLegacySdk {
  return value.engine === "webgl-v1";
}

/**
 * 迁移期宽松 Provider 的归一：**只**在 legacy client 工厂的入口使用。
 *
 * v2 / v3-beta 的 `{ load }` 形状返回裸全局对象，属于显式接受的迁移期契约；
 * 默认（v4）路径不走这里，而是经 `assertLoadedJsapiV4` 硬性失败。
 */
export function toLoadedLegacySdk(value: unknown): LoadedLegacySdk {
  const engine = readLoadedEngine(value);
  if (engine === "jsapi-v4") {
    throw new BMapError(
      "BMAP_SDK_ENGINE_MISMATCH",
      "legacy client 收到 jsapi-v4 加载结果；请使用默认 createBMapClient()（v4）而不是 legacy 工厂",
      { engine },
    );
  }
  if (isLoadedSdk(value) && isLoadedLegacySdk(value)) return value;
  return loadedLegacySdk(value);
}

/**
 * 客户端收口：加载结果必须是结构化的 `LoadedSdk`。
 *
 * 裸 `unknown`、缺 `engine` 判别字段都会在这里失败——这正是「Client 不再接收裸 SDK
 * `unknown` 作为公共加载结果」的判定点。engine 与目标 Driver 是否匹配由各 Driver
 * 工厂负责（v4 工厂只接受 `jsapi-v4`，legacy 工厂只接受 `webgl-v1`）。
 */
export function assertLoadedSdk(value: unknown): LoadedSdk {
  const engine = readLoadedEngine(value);
  if (!engine) {
    throw new BMapError(
      "BMAP_SDK_ENGINE_MISMATCH",
      "Provider 必须返回结构化的 LoadedSdk（engine + namespace），不接受裸 SDK unknown；" +
        "迁移期宽松 Provider 请使用 withMigrationDriver() / createLegacyBMapClient()",
    );
  }
  if (!("namespace" in (value as object))) {
    throw new BMapError(
      "BMAP_SDK_ENGINE_MISMATCH",
      `加载结果声明了 engine=${engine} 但缺少 namespace（raw SDK 逃生口）`,
      { engine },
    );
  }
  return value as LoadedSdk;
}

/**
 * 默认（v4）路径的收口：加载结果必须是 `LoadedJsapiV4`。
 *
 * 这也是「默认只接受 jsapi-v4」的判定点。
 */
export function assertLoadedJsapiV4(value: unknown): LoadedJsapiV4 {
  const loaded = assertLoadedSdk(value);
  if (isLoadedJsapiV4(loaded)) return loaded;
  throw new BMapError(
    "BMAP_SDK_ENGINE_MISMATCH",
    `createBMapClient 默认只接受 jsapi-v4 加载结果，收到 engine=${loaded.engine}；` +
      `迁移期请显式使用 createLegacyBMapClient()`,
    { engine: loaded.engine },
  );
}
