import { describe, it, expect } from "vitest";
import { createAnimationStateMachine } from "./animationState";

describe("animation state machine", () => {
  it("starts idle and transitions to playing", () => {
    const m = createAnimationStateMachine();
    expect(m.phase).toBe("idle");
    m.start();
    expect(m.phase).toBe("playing");
    expect(m.shouldRun()).toBe(true);
  });

  it("pauses by a reason and resumes only when no pause reasons remain", () => {
    const m = createAnimationStateMachine();
    m.start();
    m.pause("document-hidden");
    expect(m.phase).toBe("paused");
    expect(m.shouldRun()).toBe(false);
    m.pause("user");
    m.resume("document-hidden");
    expect(m.phase).toBe("paused"); // user 还在,不应恢复
    m.resume("user");
    expect(m.phase).toBe("playing");
  });

  it("user pause is not overwritten by document visibility restore", () => {
    const m = createAnimationStateMachine();
    m.start();
    m.pause("user"); // 用户主动暂停
    m.pause("document-hidden");
    m.resume("document-hidden"); // 页面恢复可见
    expect(m.phase).toBe("paused"); // 用户暂停仍在
    expect(m.shouldRun()).toBe(false);
  });

  it("reduced-motion stops animation", () => {
    const m = createAnimationStateMachine(true);
    m.start();
    expect(m.phase).toBe("stopped");
    expect(m.shouldRun()).toBe(false);
  });

  it("stop and dispose clear state", () => {
    const m = createAnimationStateMachine();
    m.start();
    m.pause("user");
    m.stop();
    expect(m.phase).toBe("stopped");
    expect(m.pauseReasons.size).toBe(0);
    m.dispose();
    expect(m.phase).toBe("disposed");
  });
});
