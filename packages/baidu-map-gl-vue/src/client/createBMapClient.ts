/**
 * createBMapClient
 *
 * 唯一职责：Provider 加载 -> engine 探测 -> Driver 创建 -> BMapClient 组装。
 * SDK 版本差异、构造函数、raw 对象与“不支持能力”全部限制在 Client/Driver 边界内。
 */
import type { BMapLoadOptions } from "../core/loader/url";
import { detectEngine, createDriver } from "../driver";
import type { BMapEngine } from "../driver/types/bmap";
import type { BMapClient, BMapProviderLike, CreateBMapClientOptions } from "./types";

export interface NormalizedProvider extends BMapProviderLike {
  id: string;
  getCacheKey(options: BMapLoadOptions): string;
}

export function normalizeProvider(provider: BMapProviderLike): NormalizedProvider {
  // 注意：不能直接拷贝方法引用，class 型 Provider 会丢失 this
  return {
    id: provider.id ?? "custom",
    getCacheKey: provider.getCacheKey
      ? (options) => provider.getCacheKey!(options)
      : () => "custom",
    load: (options, signal) => provider.load(options, signal),
  };
}

export async function createBMapClient(
  options: CreateBMapClientOptions,
  signal?: AbortSignal,
): Promise<BMapClient> {
  const provider = normalizeProvider(options.provider);
  const loaded = await provider.load(options.loadOptions, signal);

  const engine: BMapEngine = options.engine ?? detectEngine(loaded);

  const driver = createDriver({
    engine,
    rawSdk: loaded,
    unsupported: options.unsupported ?? "warn",
    capabilityOverrides: options.capabilityOverrides,
  });

  return {
    id: Symbol("bmap-client"),
    engine,
    version: driver.version,
    driver,
    capabilities: driver.capabilities,
    rawSdk: loaded,
  };
}
