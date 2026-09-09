/**
 * BMapClient 类型
 */
import type { BMapLoadOptions } from "../core/loader/url";
import type { Capability } from "../driver/capability/catalog";
import type { CapabilityRegistry } from "../driver/capability/registry";
import type { UnsupportedBehavior } from "../driver/capability/unsupported";
import type { BMapDriver, BMapEngine } from "../driver/types/bmap";

/** Provider 的最小输入形状（BMapProvider 或轻量 { load } 对象均兼容） */
export interface BMapProviderLike {
  readonly id?: string;
  getCacheKey?(options: BMapLoadOptions): string;
  load(options: BMapLoadOptions, signal?: AbortSignal): Promise<unknown>;
}

export interface BMapClient {
  readonly id: symbol;
  readonly engine: BMapEngine;
  readonly version: string;
  readonly driver: BMapDriver;
  readonly capabilities: CapabilityRegistry;
  /** raw SDK 逃生口：普通业务代码请优先使用 driver；只有 `./advanced` 使用者才应读取 */
  readonly rawSdk: unknown;
}

export interface CreateBMapClientOptions {
  provider: BMapProviderLike;
  loadOptions: BMapLoadOptions;
  engine?: BMapEngine;
  unsupported?: UnsupportedBehavior;
  capabilityOverrides?: Partial<Record<Capability, boolean>>;
}

/** 命名一致化入口：把内联对象归一为 CreateBMapClientOptions */
export function createBMapClientDefinition(options: CreateBMapClientOptions): CreateBMapClientOptions {
  return options;
}
