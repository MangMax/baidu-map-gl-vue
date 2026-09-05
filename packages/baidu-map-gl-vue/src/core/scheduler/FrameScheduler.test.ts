import { describe, it, expect, vi } from "vitest";
import { createFrameScheduler } from "./FrameScheduler";

function fakeRaf() {
  let callbacks: FrameRequestCallback[] = [];
  const raf = (cb: FrameRequestCallback) => {
    callbacks.push(cb);
    return callbacks.length;
  };
  const cancelAnimationFrame = () => {
    callbacks = [];
  };
  const flush = () => {
    const cbs = callbacks;
    callbacks = [];
    for (const cb of cbs) cb(0);
  };
  return { raf, flush, cancelAnimationFrame };
}

describe("FrameScheduler", () => {
  it("coalesces same-key tasks within one frame", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.schedule("a", () => run("a1"));
    s.schedule("a", () => run("a2"));
    s.schedule("a", () => run("a3"));
    flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("a3");
  });

  it("runs different keys in the same frame", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.schedule("x", () => run("x"));
    s.schedule("y", () => run("y"));
    flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("cancel(key) removes a scheduled task", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.schedule("a", () => run("a"));
    s.cancel("a");
    flush();
    expect(run).not.toHaveBeenCalled();
  });

  it("flush() runs immediately without waiting for next frame", () => {
    const { raf } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.schedule("a", () => run("a"));
    s.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("dispose() clears tasks and ignores future schedules", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.schedule("a", () => run("a"));
    s.dispose();
    s.schedule("b", () => run("b"));
    flush();
    expect(run).not.toHaveBeenCalled();
  });
});
