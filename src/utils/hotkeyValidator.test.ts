import { describe, expect, it } from "vitest";

import { getValidationMessage, normalizeHotkey, validateHotkey } from "./hotkeyValidator";

describe("hotkeyValidator", () => {
  it("normalizes common modifier aliases and casing", () => {
    expect(normalizeHotkey("ctrl + alt + k", "win32")).toBe("Control+Alt+K");
    expect(normalizeHotkey("command + shift + 9", "darwin")).toBe("Command+Shift+9");
  });

  it("rejects shortcuts without a modifier or special key", () => {
    const result = validateHotkey("A", "win32");
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("NO_MODIFIER_OR_SPECIAL");
  });

  it("rejects shortcuts with more than three parts", () => {
    const result = validateHotkey("Control+Alt+Shift+K", "win32");
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("TOO_MANY_KEYS");
  });

  it("rejects mixing left and right modifiers", () => {
    const result = validateHotkey("LeftControl+RightControl+K", "win32");
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("LEFT_RIGHT_MIX");
  });

  it("detects duplicates by normalized form", () => {
    const result = validateHotkey("Control+Alt+K", "win32", ["Ctrl+Alt+K"]);
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("DUPLICATE");
  });

  it("detects reserved shortcuts and returns a user-friendly message", () => {
    const result = validateHotkey("Control+Alt+Delete", "win32");
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("RESERVED");

    const message = getValidationMessage("Control+Alt+Delete", "win32");
    expect(message).toMatch(/reserved/i);
  });

  it("supports right-side single-modifier hotkeys on Windows but not Linux", () => {
    const win = validateHotkey("RightAlt", "win32");
    expect(win.valid).toBe(true);

    const linux = validateHotkey("RightAlt", "linux");
    expect(linux.valid).toBe(false);
    expect(linux.errorCode).toBe("LEFT_MODIFIER_ONLY");
  });

  it("treats Globe/Fn as macOS-only", () => {
    expect(validateHotkey("GLOBE", "darwin").valid).toBe(true);
    expect(validateHotkey("GLOBE", "win32").errorCode).toBe("INVALID_GLOBE");
  });
});

