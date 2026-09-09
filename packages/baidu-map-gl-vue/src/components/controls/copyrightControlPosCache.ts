import type { MapReadyContext } from "../../core/context/types";
import type { ControlHandle } from "../../driver/types/handles";

export type CopyrightEntry = {
  id: number;
  content: string;
  bounds?: unknown;
};

export const copyrightControlPosCache = new Map<string, ControlHandle>();

export function removeCopyrightControlIfEmpty(
  anchor: string,
  control: ControlHandle,
  ctx: MapReadyContext,
) {
  const entries = ctx.client.driver.controls.listCopyrights(control);
  if (entries.length > 0) return;
  ctx.client.driver.controls.remove({ kind: "map", handle: ctx.map }, control);
  copyrightControlPosCache.delete(anchor);
}
