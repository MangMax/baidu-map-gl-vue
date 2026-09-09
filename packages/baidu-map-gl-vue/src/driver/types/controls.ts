/**
 * ControlDriver
 *
 * 控件构造器、anchor/offset 归一化与 add/remove 全部收进 Driver。
 */
import type { ControlHandle } from "./handles";
import type { Pixel } from "./geometry";
import type { OverlayTarget } from "./overlays";

export type ControlKind =
  | "zoom"
  | "scale"
  | "city-list"
  | "location"
  | "navigation-3d"
  | "copyright"
  | "panorama"
  | "custom";

export interface ControlOptions {
  anchor?: string;
  offset?: Pixel;
  [key: string]: unknown;
}

export interface CopyrightEntry {
  id: number;
  content: string;
  bounds?: unknown;
}

export interface ControlDriver {
  create(kind: ControlKind, options?: ControlOptions): ControlHandle;
  /** 自定义控件：render 只接收地图 DOM 容器，SDK 细节留在 Driver 内 */
  createCustomControl(options: {
    anchor?: string;
    offset?: Pixel;
    render: (mapContainer: HTMLElement) => HTMLElement | null;
  }): ControlHandle;
  add(target: OverlayTarget, control: ControlHandle): void;
  remove(target: OverlayTarget, control: ControlHandle): void;
  show(control: ControlHandle): void;
  hide(control: ControlHandle): void;
  setOptions(control: ControlHandle, options: Record<string, unknown>): void;

  addCopyright(control: ControlHandle, copyright: CopyrightEntry): void;
  removeCopyright(control: ControlHandle, id: number): void;
  listCopyrights(control: ControlHandle): CopyrightEntry[];
}
