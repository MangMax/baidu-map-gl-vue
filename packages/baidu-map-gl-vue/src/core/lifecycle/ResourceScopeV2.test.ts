import { describe, it, expect, vi } from "vitest";
import { ResourceScope } from "./ResourceScope";

describe("ResourceScope v2", () => {
  it("exposes label and size", () => {
    const scope = new ResourceScope({ label: "map-runtime" });
    expect(scope.label).toBe("map-runtime");
    expect(scope.size).toBe(0);
    scope.add(() => {});
    scope.add(() => {});
    expect(scope.size).toBe(2);
    scope.dispose();
    expect(scope.size).toBe(0);
  });

  it("timeout fires once and removes itself from the set", async () => {
    const scope = new ResourceScope({ label: "t" });
    const fn = vi.fn();
    scope.timeout(fn, 5);
    expect(scope.size).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(scope.size).toBe(0);
    scope.dispose();
  });

  it("interval returns a disposer that cancels", async () => {
    const scope = new ResourceScope();
    const fn = vi.fn();
    const dispose = scope.interval(fn, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(fn.mock.calls.length).toBeGreaterThan(0);
    dispose();
    const n = fn.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(fn.mock.calls.length).toBe(n);
    scope.dispose();
  });

  it("frame fires once and self-removes", async () => {
    const scope = new ResourceScope();
    const fn = vi.fn();
    scope.frame(fn);
    expect(scope.size).toBe(1);
    await new Promise((r) => setTimeout(r, 40));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(scope.size).toBe(0);
    scope.dispose();
  });

  it("reports dispose errors via onDisposeError without interrupting others", () => {
    const seen: unknown[] = [];
    const scope = new ResourceScope({
      onDisposeError: (e) => seen.push(e),
    });
    const order: string[] = [];
    scope.add(() => order.push("a"));
    scope.add(() => {
      throw new Error("boom");
    });
    scope.add(() => order.push("c"));
    scope.dispose();
    expect(order).toEqual(["c", "a"]);
    expect(seen).toHaveLength(1);
  });

  it("fork links parent dispose and detaches on child dispose", () => {
    const parent = new ResourceScope({ label: "parent" });
    const child = parent.fork("child");
    expect(child.label).toBe("child");
    expect(parent.size).toBe(1);
    child.dispose();
    expect(parent.size).toBe(0);
    parent.dispose();
  });

  it("child disposed when parent disposes", () => {
    const parent = new ResourceScope();
    const child = parent.fork();
    child.add(vi.fn());
    parent.dispose();
    expect(child.isDisposed).toBe(true);
  });

  it("aborts when parentSignal aborts", async () => {
    const parent = new ResourceScope();
    const child = new ResourceScope({ parentSignal: parent.signal });
    expect(child.isDisposed).toBe(false);
    parent.dispose("test");
    await Promise.resolve();
    expect(child.isDisposed).toBe(true);
  });

  it("dispose accepts a reason", () => {
    const scope = new ResourceScope();
    expect(() => scope.dispose("vue-scope-disposed")).not.toThrow();
    expect(scope.isDisposed).toBe(true);
  });
});
