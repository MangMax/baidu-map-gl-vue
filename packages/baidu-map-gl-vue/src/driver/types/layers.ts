/**
 * LayerDriver
 *
 * 图层构造器与 add/remove(区分 addTileLayer/addDistrictLayer 等变体)收进 Driver。
 */
import type { LayerHandle } from "./handles";
import type { OverlayTarget } from "./overlays";

export type LayerKind = "district" | "panorama-coverage" | "tile";

export interface LayerDriver {
  create(kind: LayerKind, options?: Record<string, unknown>): LayerHandle;
  add(target: OverlayTarget, layer: LayerHandle): void;
  remove(target: OverlayTarget, layer: LayerHandle): void;
  setOptions(layer: LayerHandle, options: Record<string, unknown>): void;
}
