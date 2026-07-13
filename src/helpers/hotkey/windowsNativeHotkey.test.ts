import { describe, expect, it } from "vitest";

import nativeHotkey from "./windowsNativeHotkey.js";

const { isWindowsNativeHotkeySupported } = nativeHotkey as any;

describe("isWindowsNativeHotkeySupported", () => {
  it.each([
    "F10",
    "Fn+F10",
    "Control+Shift+Space",
    "Control+Alt",
    "RightControl",
    "Alt+PageDown",
    "Control+Super+K",
  ])("accepts %s", (hotkey) => {
    expect(isWindowsNativeHotkeySupported(hotkey)).toBe(true);
  });

  it.each(["", "GLOBE", "Fn", "MediaPlayPause", "Control+MediaPlayPause", "A+B"])(
    "rejects %s",
    (hotkey) => {
      expect(isWindowsNativeHotkeySupported(hotkey)).toBe(false);
    }
  );
});
