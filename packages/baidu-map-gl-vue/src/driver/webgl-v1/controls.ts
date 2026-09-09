/**
 * webgl-v1 ControlDriver
 */
import { createHandle } from "../types/handles";
import type { ControlDriver, ControlKind } from "../types/controls";
import type { GeometryDriver } from "../types/geometry";
import { callOptional, sdkCall, sdkCtor } from "./internal";

const CONTROL_CTORS: Record<Exclude<ControlKind, "custom">, string> = {
  zoom: "ZoomControl",
  scale: "ScaleControl",
  "city-list": "CityListControl",
  location: "LocationControl",
  "navigation-3d": "NavigationControl3D",
  copyright: "CopyrightControl",
  panorama: "PanoramaControl",
};

export interface WebGlV1ControlDriverInput {
  rawSdk: unknown;
  geometry: GeometryDriver;
}

export function createWebGlV1ControlDriver(input: WebGlV1ControlDriverInput): ControlDriver {
  const { rawSdk, geometry } = input;

  const resolveAnchor = (anchor?: string): string => {
    const win = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : {};
    const value = anchor ?? "BMAP_ANCHOR_TOP_LEFT";
    return (win[value] as string | undefined) ?? value;
  };

  return {
    create(kind, options = {}) {
      const ctorName = (CONTROL_CTORS as Record<string, string | undefined>)[kind];
      if (!ctorName) throw new Error(`Unknown control kind: ${kind}`);
      const ctor = sdkCtor(rawSdk, ctorName);
      const opts: Record<string, unknown> = { ...options };
      delete opts.offset;
      opts.offset = geometry.toRawSize({
        width: options.offset?.x ?? 0,
        height: options.offset?.y ?? 0,
      });
      opts.anchor = resolveAnchor(options.anchor);
      const control = sdkCall(ctorName, () => new ctor(opts));
      return createHandle("control", control);
    },

    createCustomControl({ anchor, offset, render }) {
      const ctor = sdkCtor(rawSdk, "Control");
      const control = sdkCall("Control", () => new ctor()) as {
        defaultAnchor?: unknown;
        defaultOffset?: unknown;
        initialize?: (map: unknown) => HTMLElement;
      };
      control.defaultAnchor = resolveAnchor(anchor);
      control.defaultOffset = geometry.toRawSize({
        width: offset?.x ?? 0,
        height: offset?.y ?? 0,
      });
      control.initialize = (map) => {
        const mapRaw = map as { getContainer: () => HTMLElement };
        return render(mapRaw.getContainer()) ?? mapRaw.getContainer();
      };
      return createHandle("control", control);
    },

    add(target, control) {
      callOptional(target.handle.raw, "addControl", control.raw);
    },

    remove(target, control) {
      callOptional(target.handle.raw, "removeControl", control.raw);
    },

    show(control) {
      callOptional(control.raw, "show");
    },

    hide(control) {
      callOptional(control.raw, "hide");
    },

    setOptions(control, options) {
      const raw = control.raw as Record<string, unknown>;
      for (const [key, value] of Object.entries(options)) {
        if (key === "offset") {
          const p = value as { x: number; y: number };
          raw.defaultOffset = geometry.toRawSize({ width: p.x, height: p.y });
          continue;
        }
        if (key === "anchor") {
          raw.defaultAnchor = resolveAnchor(value as string);
          continue;
        }
        const setter = `set${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        callOptional(raw, setter, value);
      }
    },

    addCopyright(control, copyright) {
      const raw = control.raw as { addCopyright?: (c: unknown) => void };
      callOptional(raw, "addCopyright", copyright);
    },

    removeCopyright(control, id) {
      const raw = control.raw as { removeCopyright?: (id: number) => void };
      callOptional(raw, "removeCopyright", id);
    },

    listCopyrights(control) {
      const raw = control.raw as { getCopyrightCollection?: () => unknown };
      const entries = callOptional(raw, "getCopyrightCollection");
      return ((entries as { id: number; content: string }[] | undefined) ?? []).map((entry) => ({
        id: entry.id,
        content: entry.content,
      }));
    },
  };
}
