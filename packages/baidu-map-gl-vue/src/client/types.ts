/**
 * BMapClient 类型
 *
 * M3A1-CLIENT（issue #18）：Client 从结构化的 `LoadedSdk` 创建 Driver，metadata 上把
 * **组件库版本 / engine / SDK 运行时版本** 三个维度独立报告，不再用同一个 `version`
 * 混合表达。
 */
import type { BMapLoadOptions } from "../core/loader/url";
import type { LoadedJsapiV4, LoadedSdk } from "../core/loader/loaded";
import type { Capability } from "../driver/capability/catalog";
import type { CapabilityRegistry } from "../driver/capability/registry";
import type { UnsupportedBehavior } from "../driver/capability/unsupported";
import type { BMapDriver, BMapEngine } from "../driver/types/bmap";

/**
 * 结构化 Provider：`load` 必须返回 `LoadedSdk`（v4 为 `LoadedJsapiV4`）。
 * 内置 Provider（v4 家族与迁移期 legacy 家族）都满足这一形状。
 */
export interface BMapProviderLike {
  readonly id?: string;
  getCacheKey?(options: BMapLoadOptions): string;
  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<LoadedSdk>;
}

/**
 * 迁移期宽松 Provider：v2 / v3-beta 的 `{ load }` 形状，`load` 返回裸全局对象。
 *
 * **只允许**经 `withMigrationDriver()` / `createLegacyBMapClient()` 使用（两者都会先把它
 * 归一为结构化结果）；`createBMapClient` 的 `provider` 只接受结构化的 `BMapProviderLike`。
 */
export interface LooseBMapProviderLike {
  readonly id?: string;
  getCacheKey?(options: BMapLoadOptions): string;
  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<unknown>;
}

/** 组件 props 与迁移期归一接受的 Provider 形状。 */
export type AnyBMapProviderLike = BMapProviderLike | LooseBMapProviderLike;

/** Driver 工厂的输入：结构化加载结果 + 能力策略。 */
export interface BMapDriverInput {
  readonly loaded: LoadedSdk;
  readonly unsupported: UnsupportedBehavior;
  readonly capabilityOverrides?: Partial<Record<Capability, boolean>>;
}

/**
 * Driver 工厂注入点。
 *
 * 默认注入 `createJsapiV4Driver`（只接受 `jsapi-v4`）；迁移期可用
 * `legacyDriverFactory`（`createLegacyBMapClient` 已封装）。
 */
export type BMapDriverFactory = (input: BMapDriverInput) => BMapDriver;

export interface BMapClient {
  readonly id: symbol;
  readonly engine: BMapEngine;
  /** 组件库版本（`baidu-map-gl-vue` 包版本，见 `src/version.ts`）。 */
  readonly libraryVersion: string;
  /** SDK 运行时版本（来自结构化加载结果；legacy 由 Driver 探测）。 */
  readonly sdkVersion: string;
  /** @deprecated 兼容别名，等于 `sdkVersion`；请按语义选择 `libraryVersion` / `sdkVersion`。 */
  readonly version: string;
  readonly driver: BMapDriver;
  readonly capabilities: CapabilityRegistry;
  /** raw SDK 逃生口：普通业务代码请优先使用 driver；只有 `./advanced` 使用者才应读取 */
  readonly rawSdk: unknown;
}

export interface CreateBMapClientOptions {
  /** 结构化的 Provider：`load` 必须返回 `LoadedSdk`（不接受裸全局对象）。 */
  provider: BMapProviderLike;
  loadOptions: BMapLoadOptions;
  /**
   * Driver 工厂注入点。缺省注入 `createJsapiV4Driver`，因此默认路径只接受
   * `jsapi-v4`；迁移期请显式使用 `createLegacyBMapClient()` 或 `withMigrationDriver()`。
   */
  driver?: BMapDriverFactory;
  unsupported?: UnsupportedBehavior;
  capabilityOverrides?: Partial<Record<Capability, boolean>>;
}

/** 命名一致化入口：把内联对象归一为 CreateBMapClientOptions */
export function createBMapClientDefinition(options: CreateBMapClientOptions): CreateBMapClientOptions {
  return options;
}
