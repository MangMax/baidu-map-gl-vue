import { describe, it, expect } from "vitest";
import { createOverlayRegistry } from "./OverlayRegistry";
import { ResourceScope } from "../lifecycle/ResourceScope";

describe("OverlayRegistry", () => {
  it("registers and queries by type", () => {
    const reg = createOverlayRegistry();
    const id = reg.register("marker", { id: "m1" });
    expect(reg.size).toBe(1);
    expect(reg.get(id)?.type).toBe("marker");
    expect(reg.getByType("marker")).toHaveLength(1);
  });

  it("unregister removes an overlay", () => {
    const reg = createOverlayRegistry();
    const id = reg.register("marker", {});
    reg.unregister(id);
    expect(reg.size).toBe(0);
  });

  it("clearAll simulates map.clearOverlays", () => {
    const reg = createOverlayRegistry();
    reg.register("marker", {});
    reg.register("polygon", {});
    reg.clearAll();
    expect(reg.size).toBe(0);
  });

  it("dispose disposes owner scopes in reverse order", () => {
    const reg = createOverlayRegistry();
    const a = new ResourceScope();
    const b = new ResourceScope();
    reg.register("a", {}, a);
    reg.register("b", {}, b);
    reg.dispose();
    expect(a.isDisposed).toBe(true);
    expect(b.isDisposed).toBe(true);
  });
});
