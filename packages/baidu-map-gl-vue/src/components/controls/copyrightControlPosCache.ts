import type { MapReadyContext } from "../../core/context/types";

export type CopyrightEntry = {
  id: number;
  content: string;
  bounds?: unknown;
};

export type CopyrightControl = {
  addCopyright: (copyright: CopyrightEntry) => void;
  removeCopyright: (id: number) => void;
  getCopyrightCollection?: () => CopyrightEntry[];
};

export const copyrightControlPosCache = new Map<string, CopyrightControl>();

export function removeCopyrightControlIfEmpty(
  anchor: string,
  control: CopyrightControl,
  ctx: MapReadyContext,
) {
  const entries = control.getCopyrightCollection?.() ?? [];
  if (entries.length > 0) return;
  (ctx.map as { removeControl: (control: unknown) => void }).removeControl(control);
  copyrightControlPosCache.delete(anchor);
}
