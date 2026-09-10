/**
 * CapabilityRegistry
 *
 * 运行时能力探测：显式 override → 声明状态 → engine 白名单 → raw member 存在性。
 * require() 按 unsupported 策略 throw/warn/silent。
 */
import { logger } from "../../core/logger";
import type { BMapEngine } from "../types/bmap";
import {
  CAPABILITY_CATALOG,
  CAPABILITY_IDS,
  type Capability,
  type CapabilityDescriptor,
  type CapabilityFamily,
  type CapabilityStatus,
} from "./catalog";
import { UnsupportedCapabilityError, type UnsupportedBehavior } from "./unsupported";

export type CapabilityReason =
  | "supported"
  | "engine-unsupported"
  | "raw-member-missing"
  | "status-unsupported"
  | "overridden";

export interface CapabilityExplanation {
  id: Capability;
  supported: boolean;
  reason: CapabilityReason;
  engine: BMapEngine;
  version: string;
  family: CapabilityFamily;
  status: CapabilityStatus;
  runtimeOnly: boolean;
}

export interface CapabilityRegistry {
  supports(capability: Capability): boolean;
  require(capability: Capability): void;
  list(): readonly Capability[];
  explain(capability: Capability): CapabilityExplanation;
  /** 只读访问能力描述符（能力矩阵生成与诊断使用） */
  descriptor(capability: Capability): CapabilityDescriptor | undefined;
}

export interface CreateCapabilityRegistryOptions {
  engine: BMapEngine;
  version: string;
  rawSdk: unknown;
  unsupported?: UnsupportedBehavior;
  overrides?: Partial<Record<Capability, boolean>>;
}

function hasMember(rawSdk: unknown, member: string): boolean {
  const sdk = rawSdk as Record<string, unknown> | null | undefined;
  if (!sdk) return false;
  if (typeof sdk[member] !== "undefined") return true;
  const mapProto = (sdk.Map as { prototype?: Record<string, unknown> } | undefined)?.prototype;
  return typeof mapProto?.[member] === "function";
}

export function createCapabilityRegistry(
  options: CreateCapabilityRegistryOptions,
): CapabilityRegistry {
  const { engine, version, rawSdk, unsupported = "warn", overrides } = options;

  type BaseReason = Exclude<CapabilityReason, "overridden">;

  const evaluate = (
    capability: Capability,
  ): { supported: boolean; reason: BaseReason; descriptor: CapabilityDescriptor | undefined } => {
    const descriptor = CAPABILITY_CATALOG[capability];
    if (!descriptor) return { supported: false, reason: "engine-unsupported", descriptor };
    if (descriptor.status === "unsupported") {
      return { supported: false, reason: "status-unsupported", descriptor };
    }
    if (!descriptor.engines.includes(engine)) {
      return { supported: false, reason: "engine-unsupported", descriptor };
    }
    for (const member of descriptor.rawMembers ?? []) {
      if (!hasMember(rawSdk, member)) {
        return { supported: false, reason: "raw-member-missing", descriptor };
      }
    }
    return { supported: true, reason: "supported", descriptor };
  };

  const baseSupported = (capability: Capability): boolean => {
    const override = overrides?.[capability];
    if (typeof override === "boolean") return override;
    return evaluate(capability).supported;
  };

  const registry: CapabilityRegistry = {
    supports(capability) {
      return baseSupported(capability);
    },

    require(capability) {
      if (registry.supports(capability)) return;
      const error = new UnsupportedCapabilityError(capability, engine, version);
      if (unsupported === "throw") throw error;
      if (unsupported === "warn") logger.warn(error.message, { capability, engine, version });
    },

    list() {
      return CAPABILITY_IDS.filter((capability) => baseSupported(capability));
    },

    explain(capability) {
      const descriptor = CAPABILITY_CATALOG[capability];
      const metadata = {
        id: capability,
        engine,
        version,
        family: descriptor?.family ?? ("runtime" as CapabilityFamily),
        status: descriptor?.status ?? ("unsupported" as CapabilityStatus),
        runtimeOnly: descriptor?.runtimeOnly ?? true,
      };

      const override = overrides?.[capability];
      if (typeof override === "boolean") {
        return { ...metadata, supported: override, reason: "overridden" };
      }

      const { supported, reason } = evaluate(capability);
      return { ...metadata, supported, reason };
    },

    descriptor(capability) {
      return CAPABILITY_CATALOG[capability];
    },
  };

  return registry;
}
