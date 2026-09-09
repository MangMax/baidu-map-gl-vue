/**
 * CapabilityRegistry
 *
 * 运行时能力探测：engine 白名单 + raw member 存在性 + 用户 override。
 * require() 按 unsupported 策略 throw/warn/silent。
 */
import { logger } from "../../core/logger";
import type { BMapEngine } from "../types/bmap";
import { CAPABILITY_CATALOG, CAPABILITY_IDS, type Capability } from "./catalog";
import { UnsupportedCapabilityError, type UnsupportedBehavior } from "./unsupported";

export interface CapabilityExplanation {
  id: Capability;
  supported: boolean;
  reason: "supported" | "engine-unsupported" | "raw-member-missing" | "overridden";
  engine: BMapEngine;
  version: string;
}

export interface CapabilityRegistry {
  supports(capability: Capability): boolean;
  require(capability: Capability): void;
  list(): readonly Capability[];
  explain(capability: Capability): CapabilityExplanation;
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

  const baseSupported = (capability: Capability): boolean => {
    const override = overrides?.[capability];
    if (typeof override === "boolean") return override;
    const descriptor = CAPABILITY_CATALOG[capability];
    if (!descriptor) return false;
    if (!descriptor.engines.includes(engine)) return false;
    for (const member of descriptor.rawMembers ?? []) {
      if (!hasMember(rawSdk, member)) return false;
    }
    return true;
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
      if (!descriptor) {
        return {
          id: capability,
          supported: false,
          reason: "engine-unsupported",
          engine,
          version,
        };
      }
      const override = overrides?.[capability];
      if (typeof override === "boolean") {
        return { id: capability, supported: override, reason: "overridden", engine, version };
      }
      if (!descriptor.engines.includes(engine)) {
        return { id: capability, supported: false, reason: "engine-unsupported", engine, version };
      }
      for (const member of descriptor.rawMembers ?? []) {
        if (!hasMember(rawSdk, member)) {
          return { id: capability, supported: false, reason: "raw-member-missing", engine, version };
        }
      }
      return { id: capability, supported: true, reason: "supported", engine, version };
    },
  };

  return registry;
}
