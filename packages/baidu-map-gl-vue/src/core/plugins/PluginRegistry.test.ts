import { describe, it, expect, vi } from "vitest";
import { createPluginRegistry, type BMapPluginDefinition } from "./PluginRegistry";
import { ResourceScope } from "../lifecycle/ResourceScope";

function makeContext() {
  return { api: { BMapGL: {} }, map: { id: "map" } };
}

function defer<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PluginRegistry", () => {
  it("registers and loads a plugin", async () => {
    const events = { emit: vi.fn() };
    const scope = new ResourceScope();
    const reg = createPluginRegistry(makeContext(), events, scope);
    reg.register<{ v: number }>({
      name: "A",
      load: async () => ({ v: 1 }),
    });
    const r = await reg.whenPlugin<{ v: number }>("A");
    expect(r.v).toBe(1);
    expect(events.emit).toHaveBeenCalledWith("plugin:ready", { name: "A" });
  });

  it("rejects duplicate registration", () => {
    const reg = createPluginRegistry(makeContext(), { emit: () => {} }, new ResourceScope());
    reg.register({ name: "A", load: async () => ({}) });
    expect(() => reg.register({ name: "A", load: async () => ({}) })).toThrow(/already registered/);
  });

  it("loads dependencies in topological order", async () => {
    const order: string[] = [];
    const reg = createPluginRegistry(makeContext(), { emit: () => {} }, new ResourceScope());
    reg.register<void>({
      name: "base",
      load: async () => {
        order.push("base");
      },
    });
    reg.register<void>({
      name: "dep",
      dependencies: ["base"],
      load: async () => {
        order.push("dep");
      },
    });
    reg.register<void>({
      name: "root",
      dependencies: ["dep"],
      load: async () => {
        order.push("root");
      },
    });
    await reg.whenPlugin("root");
    expect(order).toEqual(["base", "dep", "root"]);
  });

  it("detects circular dependencies", async () => {
    const reg = createPluginRegistry(makeContext(), { emit: () => {} }, new ResourceScope());
    reg.register<void>({ name: "a", dependencies: ["b"], load: async () => {} });
    reg.register<void>({ name: "b", dependencies: ["a"], load: async () => {} });
    await expect(reg.whenPlugin("a")).rejects.toThrow(/cyclic/i);
  });

  it("throws for missing dependency", async () => {
    const reg = createPluginRegistry(makeContext(), { emit: () => {} }, new ResourceScope());
    reg.register<void>({ name: "a", dependencies: ["missing"], load: async () => {} });
    await expect(reg.whenPlugin("a")).rejects.toThrow(/missing plugin/i);
  });

  it("handles required=false plugin failure gracefully", async () => {
    const reg = createPluginRegistry(makeContext(), { emit: vi.fn() }, new ResourceScope());
    reg.register<void>({
      name: "optional",
      required: false,
      load: async () => {
        throw new Error("opt fail");
      },
    });
    const result = await reg.whenPlugin("optional");
    expect(result).toBeUndefined();
    expect(reg.getStatus("optional")).toBe("error");
  });

  it("dispose calls plugin dispose and marks disposed", async () => {
    const dispose = vi.fn();
    const reg = createPluginRegistry(makeContext(), { emit: () => {} }, new ResourceScope());
    reg.register({ name: "p", load: async () => ({ x: 1 }), dispose });
    await reg.whenPlugin("p");
    reg.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(reg.getStatus("p")).toBe("disposed");
  });
});
