import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const {
  checkAccessibilityPermissions,
  isStuckAccessibilityPermissionError,
} = require("./macosAccessibility");

describe("macosAccessibility", () => {
  it("detects common stuck permission errors", () => {
    expect(isStuckAccessibilityPermissionError("not allowed assistive access")).toBe(true);
    expect(isStuckAccessibilityPermissionError("(-1719)")).toBe(true);
    expect(isStuckAccessibilityPermissionError("other")).toBe(false);
  });

  it("returns cached permission results without spawning", async () => {
    const spawn = vi.fn(() => new EventEmitter() as any);
    const manager = {
      deps: { platform: "darwin", spawn, now: () => 1000 },
      accessibilityCache: { value: true, expiresAt: 2000 },
    };

    expect(await checkAccessibilityPermissions(manager)).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });
});

