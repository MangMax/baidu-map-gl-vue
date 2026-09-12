/**
 * webgl-v1 LayerDriver
 *
 * BMapGL 没有 4.0 的统一 `map.addLayer/removeLayer`：行政区走 `addDistrictLayer`，
 * 其余图层（`TileLayer` 及其子类）走 `addTileLayer`。原先 `tile` 落到不存在的 `addLayer`
 * 上，`callOptional` 会把它变成静默 no-op——M3A2-CONTROLS-LAYERS（#22）统一两个引擎的
 * add/remove 语义时一并修掉，并登记在 ADR 的「迁移影响」里。
 */
import { BMapError } from "../../core/errors/BMapError";
import { createHandle, HANDLE_BRAND, type LayerHandle } from "../types/handles";
import type { LayerDriver, LayerKind } from "../types/layers";
import type { OverlayTarget } from "../types/overlays";
import { callOptional, sdkCall, sdkCtor } from "./internal";

const LAYER_CTORS: Record<LayerKind, string> = {
  district: "DistrictLayer",
  "panorama-coverage": "PanoramaCoverageLayer",
  tile: "TileLayer",
};

/** 挂载入口按 kind 分流：行政区有专用入口，其余图层共用 `addTileLayer`。 */
const LAYER_MOUNT_METHODS: Record<LayerKind, { add: string; remove: string }> = {
  district: { add: "addDistrictLayer", remove: "removeDistrictLayer" },
  "panorama-coverage": { add: "addTileLayer", remove: "removeTileLayer" },
  tile: { add: "addTileLayer", remove: "removeTileLayer" },
};

export interface WebGlV1LayerDriverInput {
  rawSdk: unknown;
}

export function createWebGlV1LayerDriver(input: WebGlV1LayerDriverInput): LayerDriver {
  const { rawSdk } = input;

  const kindOf = (layer: LayerHandle): LayerKind => {
    const brand = layer[HANDLE_BRAND] as unknown;
    const value = String(brand);
    const match = /^layer:(.+)$/.exec(value);
    return (match?.[1] as LayerKind | undefined) ?? "tile";
  };

  /** 图层只能挂到 Map：显式拒绝而非让 `callOptional` 把它变成静默 no-op（同 controls.ts）。 */
  const requireMapTarget = (target: OverlayTarget, operation: string): Record<string, unknown> => {
    if (target.kind !== "map") {
      throw new BMapError(
        "BMAP_SDK_CALL_FAILED",
        `LayerDriver.${operation}: BMapGL 的图层只能挂到 Map（addDistrictLayer / addTileLayer）；` +
          `目标 kind="${target.kind}" 没有运行时入口`,
        { engine: "webgl-v1" },
      );
    }
    return target.handle.raw as Record<string, unknown>;
  };

  return {
    create(kind, options = {}) {
      const ctor = sdkCtor(rawSdk, LAYER_CTORS[kind]);
      const layer = sdkCall(LAYER_CTORS[kind], () => new ctor(options));
      return createHandle(`layer:${kind}` as "layer", layer);
    },

    add(target, layer) {
      const methods = LAYER_MOUNT_METHODS[kindOf(layer)];
      callOptional(requireMapTarget(target, "add"), methods.add, layer.raw);
    },

    remove(target, layer) {
      const methods = LAYER_MOUNT_METHODS[kindOf(layer)];
      callOptional(requireMapTarget(target, "remove"), methods.remove, layer.raw);
    },

    setOptions(layer, options) {
      const raw = layer.raw as Record<string, unknown>;
      for (const [key, value] of Object.entries(options)) {
        raw[key] = value;
      }
    },
  };
}
