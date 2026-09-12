/**
 * webgl-v1 ControlDriver
 *
 * 句柄品牌与 v4 一致（`control:<kind>`）：品牌是「更新口径」的依据，
 * 两个引擎用同一套品牌口径，共享契约才能在两个实现上跑同一批断言。
 */
import { BMapError } from "../../core/errors/BMapError";
import { createHandle } from "../types/handles";
import type { ControlDriver, ControlKind } from "../types/controls";
import type { GeometryDriver } from "../types/geometry";
import type { OverlayTarget } from "../types/overlays";
import { callOptional, sdkCall, sdkCtor } from "./internal";

const CONTROL_CTORS: Record<Exclude<ControlKind, "custom">, string> = {
  zoom: "ZoomControl",
  scale: "ScaleControl",
  navigation: "NavigationControl",
  "city-list": "CityListControl",
  location: "LocationControl",
  "navigation-3d": "NavigationControl3D",
  "map-type": "MapTypeControl",
  overview: "OverviewMapControl",
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

  /**
   * 控件只能挂到 Map。
   *
   * 显式拒绝而不是让 `callOptional` 把它变成静默 no-op：M3A2-CONTROLS-LAYERS（#22）
   * 统一两个引擎的 target 语义——v4 侧抛 `BMAP_CAPABILITY_UNSUPPORTED`，这里抛
   * `BMAP_SDK_CALL_FAILED`（同一个契约断言 `toThrow()`）。错误码差异属迁移期已知差异。
   */
  const requireMapTarget = (target: OverlayTarget, operation: string): Record<string, unknown> => {
    if (target.kind !== "map") {
      throw new BMapError(
        "BMAP_SDK_CALL_FAILED",
        `ControlDriver.${operation}: BMapGL 的控件只能挂到 Map（map.addControl / removeControl）；` +
          `目标 kind="${target.kind}" 没有运行时入口`,
        { engine: "webgl-v1" },
      );
    }
    return target.handle.raw as Record<string, unknown>;
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
      return createHandle(`control:${kind}`, control);
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
      return createHandle("control:custom", control);
    },

    add(target, control) {
      callOptional(requireMapTarget(target, "add"), "addControl", control.raw);
    },

    remove(target, control) {
      callOptional(requireMapTarget(target, "remove"), "removeControl", control.raw);
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
