/**
 * webgl-v1 LayerDriver
 */
import { createHandle, HANDLE_BRAND, type LayerHandle } from "../types/handles";
import type { LayerDriver, LayerKind } from "../types/layers";
import { callOptional, sdkCall, sdkCtor } from "./internal";

const LAYER_CTORS: Record<LayerKind, string> = {
  district: "DistrictLayer",
  "panorama-coverage": "PanoramaCoverageLayer",
  tile: "TileLayer",
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

  return {
    create(kind, options = {}) {
      const ctor = sdkCtor(rawSdk, LAYER_CTORS[kind]);
      const layer = sdkCall(LAYER_CTORS[kind], () => new ctor(options));
      return createHandle(`layer:${kind}` as "layer", layer);
    },

    add(target, layer) {
      const kind = kindOf(layer);
      if (kind === "district") callOptional(target.handle.raw, "addDistrictLayer", layer.raw);
      else if (kind === "panorama-coverage")
        callOptional(target.handle.raw, "addTileLayer", layer.raw);
      else callOptional(target.handle.raw, "addLayer", layer.raw);
    },

    remove(target, layer) {
      const kind = kindOf(layer);
      if (kind === "district") callOptional(target.handle.raw, "removeDistrictLayer", layer.raw);
      else if (kind === "panorama-coverage")
        callOptional(target.handle.raw, "removeTileLayer", layer.raw);
      else callOptional(target.handle.raw, "removeLayer", layer.raw);
    },

    setOptions(layer, options) {
      const raw = layer.raw as Record<string, unknown>;
      for (const [key, value] of Object.entries(options)) {
        raw[key] = value;
      }
    },
  };
}
