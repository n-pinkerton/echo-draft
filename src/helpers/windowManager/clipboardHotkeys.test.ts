import { afterEach, describe, expect, it, vi } from "vitest";

import clipboardHotkeys from "./clipboardHotkeys.js";

const {
  normalizeClipboardAccelerator,
  registerClipboardHotkeyInternal,
  unregisterClipboardHotkey,
} = clipboardHotkeys as any;

describe("clipboardHotkeys", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes Fn accelerators", () => {
    expect(normalizeClipboardAccelerator("Fn+F9")).toBe("F9");
    expect(normalizeClipboardAccelerator("Control+Option+Space")).toBe("Control+Option+Space");
  });

  it("rejects empty clipboard hotkeys", () => {
    const manager: any = {
      hotkeyManager: { getCurrentHotkey: () => "Control+Alt" },
      canRegisterClipboardWithGlobalShortcut: () => true,
      getClipboardHotkeyCallback: () => vi.fn(),
      currentClipboardHotkey: "",
      registeredClipboardAccelerator: null,
    };

    const result = registerClipboardHotkeyInternal(manager, "   ", {
      globalShortcut: { register: vi.fn(), unregister: vi.fn() },
    });

    expect(result).toEqual({ success: false, message: "Please enter a valid clipboard hotkey." });
  });

  it("rejects clipboard hotkeys that match the insert hotkey", () => {
    const manager: any = {
      hotkeyManager: { getCurrentHotkey: () => "Control+Alt" },
      canRegisterClipboardWithGlobalShortcut: () => true,
      getClipboardHotkeyCallback: () => vi.fn(),
      currentClipboardHotkey: "",
      registeredClipboardAccelerator: null,
    };

    const result = registerClipboardHotkeyInternal(manager, "Control+Alt", {
      globalShortcut: { register: vi.fn(), unregister: vi.fn() },
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch("Insert and Clipboard hotkeys must be different");
  });

  it("unregisters an existing clipboard accelerator", () => {
    const globalShortcut = { register: vi.fn(), unregister: vi.fn() };
    const manager: any = {
      registeredClipboardAccelerator: "F9",
    };

    unregisterClipboardHotkey(manager, { globalShortcut });

    expect(globalShortcut.unregister).toHaveBeenCalledWith("F9");
    expect(manager.registeredClipboardAccelerator).toBe(null);
  });

  it("registers clipboard hotkeys with globalShortcut when supported", () => {
    const globalShortcut = { register: vi.fn(() => true), unregister: vi.fn() };
    const callback = vi.fn();

    const manager: any = {
      hotkeyManager: { getCurrentHotkey: () => "Control+Alt" },
      canRegisterClipboardWithGlobalShortcut: () => true,
      getClipboardHotkeyCallback: () => callback,
      currentClipboardHotkey: "",
      registeredClipboardAccelerator: null,
    };

    const result = registerClipboardHotkeyInternal(manager, "Fn+F9", { globalShortcut });

    expect(globalShortcut.register).toHaveBeenCalledWith("F9", callback);
    expect(result).toEqual({ success: true, hotkey: "Fn+F9" });
    expect(manager.currentClipboardHotkey).toBe("Fn+F9");
    expect(manager.registeredClipboardAccelerator).toBe("F9");
  });

  it("skips globalShortcut registration when native listener is required", () => {
    const globalShortcut = { register: vi.fn(() => true), unregister: vi.fn() };

    const manager: any = {
      hotkeyManager: { getCurrentHotkey: () => "Control+Alt" },
      canRegisterClipboardWithGlobalShortcut: () => false,
      getClipboardHotkeyCallback: () => vi.fn(),
      currentClipboardHotkey: "",
      registeredClipboardAccelerator: null,
    };

    const result = registerClipboardHotkeyInternal(manager, "Control+Option+Space", { globalShortcut });

    expect(result).toEqual({ success: true, hotkey: "Control+Option+Space" });
    expect(globalShortcut.register).not.toHaveBeenCalled();
    expect(manager.currentClipboardHotkey).toBe("Control+Option+Space");
    expect(manager.registeredClipboardAccelerator).toBe(null);
  });
});

