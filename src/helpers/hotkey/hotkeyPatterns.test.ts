// @vitest-environment node
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isModifierOnlyHotkey, isRightSideModifier } = require("./hotkeyPatterns");

describe("hotkeyPatterns", () => {
  it("detects right-side modifiers", () => {
    expect(isRightSideModifier("RightAlt")).toBe(true);
    expect(isRightSideModifier("RightOption")).toBe(true);
    expect(isRightSideModifier("RightControl")).toBe(true);
    expect(isRightSideModifier("Control")).toBe(false);
  });

  it("detects modifier-only combos", () => {
    expect(isModifierOnlyHotkey("Control+Alt")).toBe(true);
    expect(isModifierOnlyHotkey("Control+Shift+Alt")).toBe(true);
    expect(isModifierOnlyHotkey("Alt+F7")).toBe(false);
    expect(isModifierOnlyHotkey("F9")).toBe(false);
  });
});

