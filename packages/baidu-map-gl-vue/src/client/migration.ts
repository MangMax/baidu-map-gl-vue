/**
 * 迁移期 Driver 工厂与 Client 工厂（显式 legacy + 组件默认归一）
 *
 * M3A1-CLIENT（issue #18）把默认客户端收口到 `jsapi-v4`：
 * `createBMapClient()` 缺省注入 `createJsapiV4Driver`，并要求 Provider 返回结构化的
 * `LoadedSdk`。迁移期仍有三类调用方需要 `webgl-v1`：
 *
 * 1. v2 / v3-beta 的宽松 `{ load }` Provider（返回裸全局对象）；
 * 2. 显式传入 legacy Provider 的调用方（`baiduCdnProvider()` 等）；
 * 3. fake SDK 测试基建。
 *
 * **组件默认路径已不再是其中之一**：`#25` 起默认 Provider 就是 JSAPI 4.0 的 CDN 家族。
 * 这里的分派现在只服务「调用方显式给了 legacy Provider」这一种情况。
 *
 * 因此这里提供三个**显式**入口，全部不是 `createBMapClient()` 的默认值：
 * - `normalizeMigrationProvider`：结构化结果原样通过，裸值按 `webgl-v1` 包装；
 * - `legacyDriverFactory` / `createLegacyBMapClient`：只接受 `webgl-v1`；
 * - `migrationDriverFactory` / `withMigrationDriver`：按**加载结果的 engine** 分派实现——
 *   这样「显式传了 legacy Provider」仍能工作，而默认（v4）路径不受影响。
 *
 * M3A.3（#26）删除 webgl-v1 后，本文件一并删除。
 */
import {
  assertLoadedSdk,
  loadedLegacySdk,
  readLoadedEngine,
  toLoadedLegacySdk,
} from "../core/loader/loaded";
import type { BMapLoadOptions } from "../core/loader/url";
import { createWebGlV1Driver } from "../driver/webgl-v1/createDriver";
import {
  createBMapClient,
  jsapiV4DriverFactory,
  normalizeProvider,
} from "./createBMapClient";
import type {
  AnyBMapProviderLike,
  BMapClient,
  BMapDriverFactory,
  BMapProviderLike,
  CreateBMapClientOptions,
} from "./types";

/**
 * 迁移期 Provider 归一。
 *
 * - 结构化 `LoadedSdk`：原样通过（engine 由下游工厂判定）；
 * - 裸值：v2 / v3-beta 的宽松形状，按 `webgl-v1` 命名空间包装（显式接受的迁移契约）。
 *
 * 默认（v4）路径**不**走这里：`createBMapClient` 直接要求结构化结果。
 *
 * 注意：裸值**无法**自述 engine——一个不带 `engine` 判别字段的 v4 命名空间与
 * webgl-v1 命名空间在结构上无法区分。因此这个入口只适用于「已知是 v2/v3-beta 全局」
 * 的迁移调用方；v4 Provider 必须返回结构化的 `LoadedJsapiV4`。
 */
export function normalizeMigrationProvider(provider: AnyBMapProviderLike): BMapProviderLike {
  const normalized = normalizeProvider(provider);
  return {
    id: normalized.id,
    getCacheKey: (options: BMapLoadOptions) => normalized.getCacheKey(options),
    load: async (options, signal) => {
      const value = await normalized.load(options, signal);
      return readLoadedEngine(value) === undefined ? loadedLegacySdk(value) : assertLoadedSdk(value);
    },
  };
}

/**
 * 迁移期 legacy Driver 工厂：只接受 `webgl-v1` 加载结果。
 * 版本由 Driver 探测（`detectVersion`），Loader 不声明。
 */
export const legacyDriverFactory: BMapDriverFactory = (input) => {
  const loaded = toLoadedLegacySdk(input.loaded);
  return createWebGlV1Driver({
    rawSdk: loaded.namespace,
    unsupported: input.unsupported,
    capabilityOverrides: input.capabilityOverrides,
  });
};

/**
 * 迁移期组件默认 Driver 工厂：按加载结果的 engine 分派。
 *
 * 这是「默认配置能够无破坏地指向 v4 Provider」的落点——Provider 换成 v4 家族后，
 * 组件默认路径会自动走到 v4 工厂（Facet Driver 落地后即可工作），不需要调用方改代码。
 */
export const migrationDriverFactory: BMapDriverFactory = (input) =>
  readLoadedEngine(input.loaded) === "jsapi-v4"
    ? jsapiV4DriverFactory(input)
    : legacyDriverFactory(input);

/**
 * 迁移期 definition 输入：与 `CreateBMapClientOptions` 同形，但 `provider` 允许宽松形状
 * （组件 props 与 v2 / v3-beta 调用方）。
 */
export interface MigrationClientDefinition extends Omit<CreateBMapClientOptions, "provider"> {
  provider: AnyBMapProviderLike;
}

/**
 * 迁移期 definition 归一：把宽松 Provider 归一为结构化形状，并在未显式声明 `driver`
 * 时注入 `migrationDriverFactory`。组件/插件默认路径统一经此进入 Client。
 */
export function withMigrationDriver(
  definition: MigrationClientDefinition,
): CreateBMapClientOptions {
  return {
    ...definition,
    provider: normalizeMigrationProvider(definition.provider),
    driver: definition.driver ?? migrationDriverFactory,
  };
}

/** 显式 legacy Client 工厂：只接受 `webgl-v1`，不是 `createBMapClient` 的默认。 */
export function createLegacyBMapClient(
  options: MigrationClientDefinition,
  signal?: AbortSignal,
): Promise<BMapClient> {
  return createBMapClient(
    {
      provider: normalizeMigrationProvider(options.provider),
      loadOptions: options.loadOptions,
      driver: legacyDriverFactory,
      unsupported: options.unsupported,
      capabilityOverrides: options.capabilityOverrides,
    },
    signal,
  );
}
