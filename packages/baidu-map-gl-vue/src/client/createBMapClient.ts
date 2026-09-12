/**
 * createBMapClient
 *
 * 唯一职责：Provider 加载 -> 结构化结果收口 -> Driver 创建 -> BMapClient 组装。
 * SDK 版本差异、构造函数、raw 对象与“不支持能力”全部限制在 Client/Driver 边界内。
 *
 * M3A1-CLIENT（issue #18）：
 * - `BMapProviderLike.load` 返回结构化 `LoadedSdk`（不再返回裸 `unknown`）；
 * - **默认注入 `createJsapiV4Driver`，因此默认只接受 `jsapi-v4`**，不再做运行时
 *   engine 猜测（`detectEngine` 只在 `./advanced` 保留，默认路径不使用）；
 * - 迁移期需要 webgl-v1 时显式使用 `createLegacyBMapClient()` / `withMigrationDriver()`
 *   （见同目录 `migration.ts`，它是唯一接受宽松 Provider 形状的入口）。
 */
import { assertLoadedJsapiV4, assertLoadedSdk, type LoadedSdk } from "../core/loader/loaded";
import type { BMapLoadOptions } from "../core/loader/url";
import { createJsapiV4Driver } from "../driver/createJsapiV4Driver";
import type { BMapDriver } from "../driver/types/bmap";
import { LIBRARY_VERSION } from "../version";
import type {
  AnyBMapProviderLike,
  BMapClient,
  BMapDriverFactory,
  CreateBMapClientOptions,
} from "./types";

export interface NormalizedProvider {
  readonly id: string;
  /** 恒为函数：宽松 Provider 未提供指纹时返回 `custom`。 */
  getCacheKey(options: BMapLoadOptions): string;
  /** 迁移期宽松 Provider 可能返回裸值，由 Client 的收口/归一负责。 */
  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<unknown>;
}

export function normalizeProvider(provider: AnyBMapProviderLike): NormalizedProvider {
  // 注意：不能直接拷贝方法引用，class 型 Provider 会丢失 this
  return {
    id: provider.id ?? "custom",
    getCacheKey: provider.getCacheKey
      ? (options) => provider.getCacheKey!(options)
      : () => "custom",
    load: (options, signal) => provider.load(options, signal),
  };
}

/**
 * 默认 Driver 工厂：只接受 `jsapi-v4`。
 *
 * M3A.2 收口（#23）已把 `createJsapiV4Driver` 装配成真实 Driver（Map / Overlay / Control /
 * Layer / Service / Panorama / Native Layer 七面齐全），因此本工厂不再是「明确失败」的占位。
 * `createBMapClient()` 的默认路径现在会装出可用的 v4 Client；组件默认路径的切换（默认
 * Provider / Playground / Docs）仍是 M3A.3（#25）的事。
 */
export const jsapiV4DriverFactory: BMapDriverFactory = (input) => {
  const loaded = assertLoadedJsapiV4(input.loaded);
  return createJsapiV4Driver({
    rawSdk: loaded.namespace,
    version: loaded.version,
    unsupported: input.unsupported,
    capabilityOverrides: input.capabilityOverrides,
  });
};

/** SDK 运行时版本：v4 由 Provider 声明；legacy 由 Driver 在创建时探测。 */
function resolveSdkVersion(loaded: LoadedSdk, driver: BMapDriver): string {
  return loaded.engine === "jsapi-v4" ? loaded.version : driver.version;
}

function assembleClient(loaded: LoadedSdk, driver: BMapDriver): BMapClient {
  const sdkVersion = resolveSdkVersion(loaded, driver);
  return {
    id: Symbol("bmap-client"),
    engine: driver.engine,
    libraryVersion: LIBRARY_VERSION,
    sdkVersion,
    version: sdkVersion,
    driver,
    capabilities: driver.capabilities,
    rawSdk: driver.rawSdk,
  };
}

export async function createBMapClient(
  options: CreateBMapClientOptions,
  signal?: AbortSignal,
): Promise<BMapClient> {
  const provider = normalizeProvider(options.provider);
  const loaded = assertLoadedSdk(await provider.load(options.loadOptions, signal));

  const driver = (options.driver ?? jsapiV4DriverFactory)({
    loaded,
    unsupported: options.unsupported ?? "warn",
    capabilityOverrides: options.capabilityOverrides,
  });

  return assembleClient(loaded, driver);
}
