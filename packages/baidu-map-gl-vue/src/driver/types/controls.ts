/**
 * ControlDriver
 *
 * 控件构造器、anchor/offset 归一化与 add/remove 全部收进 Driver。
 *
 * `kind` 是**引擎无关的能力面**（M3A2-CONTROLS-LAYERS / issue #22 的目标与范围）：
 * 十个内置控件的语义名 + `custom`（业务 DOM）。各引擎负责把它映射到自己的构造器与
 * 停靠/偏移 API；组件层不需要知道 SDK 构造器名。
 *
 * 命名口径：
 * - `location` 在 JSAPI 4.0 上是 `GeolocationControl`（v4 同时保留同实现的
 *   `LocationControl` 名称，但官方 Skill 明确「新代码统一写 GeolocationControl」）；
 *   领域名保持不变，避免为一次重命名动组件契约。
 * - `anchor` 传的是官方常量**名**（`"BMAP_ANCHOR_BOTTOM_RIGHT"`），不是数值——
 *   与 webgl-v1 的组件 props 形状保持一致，由 Driver 换算成各引擎的取值。
 */
import type { ControlHandle } from "./handles";
import type { Pixel } from "./geometry";
import type { OverlayTarget } from "./overlays";

export type ControlKind =
  | "zoom"
  | "scale"
  | "navigation"
  | "navigation-3d"
  | "city-list"
  | "location"
  | "map-type"
  | "overview"
  | "panorama"
  | "copyright"
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
