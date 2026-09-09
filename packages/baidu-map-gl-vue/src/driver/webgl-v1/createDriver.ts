/**
 * webgl-v1 Driver 组装
 */
import { createCapabilityRegistry } from "../capability/registry";
import type { Capability } from "../capability/catalog";
import type { UnsupportedBehavior } from "../capability/unsupported";
import type { BMapDriver, BMapEngine } from "../types/bmap";
import { createWebGlV1ControlDriver } from "./controls";
import { createWebGlV1EventDriver } from "./events";
import { createWebGlV1GeometryDriver } from "./geometry";
import { createWebGlV1LayerDriver } from "./layers";
import { createWebGlV1MapDriver } from "./map";
import { createWebGlV1OverlayDriver } from "./overlays";
import { createWebGlV1ServiceDriver } from "./services";

export interface CreateWebGlV1DriverInput {
  rawSdk: unknown;
  unsupported: UnsupportedBehavior;
  capabilityOverrides?: Partial<Record<Capability, boolean>>;
}

export function detectVersion(rawSdk: unknown): string {
  const version = (rawSdk as { VERSION?: unknown } | null | undefined)?.VERSION;
  return typeof version === "string" && version ? version : "webgl-v1";
}

export function createWebGlV1Driver(input: CreateWebGlV1DriverInput): BMapDriver {
  const { rawSdk, unsupported, capabilityOverrides } = input;
  const engine: BMapEngine = "webgl-v1";
  const version = detectVersion(rawSdk);

  const capabilities = createCapabilityRegistry({
    engine,
    version,
    rawSdk,
    unsupported,
    overrides: capabilityOverrides,
  });

  const geometry = createWebGlV1GeometryDriver(rawSdk);

  return {
    engine,
    version,
    rawSdk,
    capabilities,
    geometry,
    map: createWebGlV1MapDriver({ rawSdk, geometry }),
    overlays: createWebGlV1OverlayDriver({ rawSdk, geometry }),
    controls: createWebGlV1ControlDriver({ rawSdk, geometry }),
    layers: createWebGlV1LayerDriver({ rawSdk }),
    services: createWebGlV1ServiceDriver({ rawSdk, geometry }),
    panorama: { supported: capabilities.supports("panorama.viewer") },
    events: createWebGlV1EventDriver(),
  };
}
