/**
 * webgl-v1 EventDriver
 */
import type { EventDriver } from "../types/events";
import { callOptional } from "./internal";

export function createWebGlV1EventDriver(): EventDriver {
  return {
    on(target, type, listener) {
      const raw = target.raw as {
        addEventListener?: (type: string, listener: (event: unknown) => void) => void;
        removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
      };
      if (typeof raw.addEventListener !== "function") return () => {};
      callOptional(raw, "addEventListener", type, listener);
      return () => callOptional(raw, "removeEventListener", type, listener);
    },
  };
}
