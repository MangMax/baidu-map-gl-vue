/**
 * EventDriver 与归一化事件
 *
 * 组件不再把 raw SDK event 直接作为主参数；事件在 Driver 边界归一化。
 */
import type { SdkHandle } from "./handles";
import type { Pixel, Point } from "./geometry";

export interface MapMouseEvent {
  point: Point;
  pixel?: Pixel;
  domEvent?: Event;
  raw: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface EventDriver {
  on<TEvent = unknown>(
    target: SdkHandle<string>,
    type: string,
    listener: (event: TEvent) => void,
  ): () => void;
}
