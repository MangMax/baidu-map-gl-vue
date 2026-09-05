import { describe, it, expect, vi } from "vitest";
import { redactAk } from "./logger";

describe("redactAk", () => {
  it("redacts a known ak in a message", () => {
    const ak = "secret-ak-123456";
    const msg = "config conflict for ak=secret-ak-123456";
    expect(redactAk(msg, ak)).toBe("config conflict for ak=***3456");
  });

  it("redacts ak= pattern when ak not provided", () => {
    const msg = "conflict ak=ABC123XYZ";
    expect(redactAk(msg)).toBe("conflict ak=***3XYZ");
  });

  it("leaves message unchanged when no ak present", () => {
    expect(redactAk("normal message")).toBe("normal message");
  });
});
