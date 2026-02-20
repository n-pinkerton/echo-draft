import { describe, expect, it } from "vitest";

import { mapKeyboardEventToHotkey } from "./keyboardEventToHotkey";

describe("mapKeyboardEventToHotkey", () => {
  it("ignores modifier key events", () => {
    const hotkey = mapKeyboardEventToHotkey({ code: "ControlLeft" } as any, "win32");
    expect(hotkey).toBe(null);
  });

  it("returns null for unsupported key codes", () => {
    const hotkey = mapKeyboardEventToHotkey({ code: "UnknownKey" } as any, "win32");
    expect(hotkey).toBe(null);
  });

  it("maps common keys with modifiers", () => {
    const win = mapKeyboardEventToHotkey(
      { code: "KeyK", ctrlKey: true, altKey: true, metaKey: false, shiftKey: false } as any,
      "win32"
    );
    expect(win).toBe("Control+Alt+K");

    const mac = mapKeyboardEventToHotkey(
      { code: "KeyK", ctrlKey: false, altKey: false, metaKey: true, shiftKey: false } as any,
      "darwin"
    );
    expect(mac).toBe("Command+K");
  });
});

