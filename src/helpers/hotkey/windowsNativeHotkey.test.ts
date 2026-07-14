import { describe, expect, it } from "vitest";

import nativeHotkey from "./windowsNativeHotkey.js";

const { canUseWindowsRegisteredTapHotkey, isWindowsNativeHotkeySupported } = nativeHotkey as any;

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

  it.each(["F10", "Fn+F10", "Control+Shift+Space", "Alt+PageDown", "Control+Super+K"])(
    "uses repeat-safe RegisterHotKey for tap shortcut %s",
    (hotkey) => {
      expect(canUseWindowsRegisteredTapHotkey(hotkey)).toBe(true);
    }
  );

  it.each(["", "GLOBE", "Fn", "Control+Alt", "RightControl", "RightAlt", "A+B"])(
    "keeps %s on the low-level-hook or unsupported path",
    (hotkey) => {
      expect(canUseWindowsRegisteredTapHotkey(hotkey)).toBe(false);
    }
  );
});
