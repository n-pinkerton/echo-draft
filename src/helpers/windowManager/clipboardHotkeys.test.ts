import { afterEach, describe, expect, it, vi } from "vitest";

import clipboardHotkeys from "./clipboardHotkeys.js";

const {
  MAX_CLIPBOARD_REGISTRATION_RETRIES,
  normalizeClipboardAccelerator,
  registerClipboardHotkeyInternal,
  unregisterClipboardHotkey,
} = clipboardHotkeys as any;

describe("clipboardHotkeys", () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it("rejects the shortcut reserved for opening the control panel", () => {
    const manager = {
      hotkeyManager: { getCurrentHotkey: () => "F10" },
      registeredClipboardAccelerator: null,
    };
    const globalShortcut = { register: vi.fn(), unregister: vi.fn() };

    const result = registerClipboardHotkeyInternal(manager, "Alt+C", { globalShortcut });

    expect(result).toMatchObject({ success: false, reason: "reserved-by-echodraft" });
    expect(globalShortcut.register).not.toHaveBeenCalled();
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

    const result = registerClipboardHotkeyInternal(manager, "Control+Option+Space", {
      globalShortcut,
    });

    expect(result).toEqual({ success: true, hotkey: "Control+Option+Space" });
    expect(globalShortcut.register).not.toHaveBeenCalled();
    expect(manager.currentClipboardHotkey).toBe("Control+Option+Space");
    expect(manager.registeredClipboardAccelerator).toBe(null);
  });

  it("recovers from a transient false registration with one bounded retry", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const globalShortcut = {
      register: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
      unregister: vi.fn(),
    };
    const manager: any = {
      hotkeyManager: { getCurrentHotkey: () => "Control+Alt" },
      canRegisterClipboardWithGlobalShortcut: () => true,
      getClipboardHotkeyCallback: () => callback,
      currentClipboardHotkey: "Fn+F9",
      registeredClipboardAccelerator: "F9",
    };

    expect(registerClipboardHotkeyInternal(manager, "Fn+F9", { globalShortcut }).success).toBe(
      false
    );
    expect(vi.getTimerCount()).toBe(1);
    vi.runOnlyPendingTimers();

    expect(manager.registeredClipboardAccelerator).toBe("F9");
    expect(manager.clipboardHotkeyRegistrationFailure).toBeNull();
    expect(globalShortcut.register).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restores a different prior shortcut while retrying the desired shortcut", () => {
    vi.useFakeTimers();
    const globalShortcut = {
      register: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(true),
      unregister: vi.fn(),
    };
    const manager: any = {
      hotkeyManager: { getCurrentHotkey: () => "Control+Alt" },
      canRegisterClipboardWithGlobalShortcut: () => true,
      getClipboardHotkeyCallback: () => vi.fn(),
      currentClipboardHotkey: "Fn+F9",
      registeredClipboardAccelerator: "F9",
    };

    expect(registerClipboardHotkeyInternal(manager, "F8", { globalShortcut }).success).toBe(false);
    expect(manager.currentClipboardHotkey).toBe("Fn+F9");
    expect(manager.registeredClipboardAccelerator).toBe("F9");

    vi.runOnlyPendingTimers();

    expect(manager.currentClipboardHotkey).toBe("F8");
    expect(manager.registeredClipboardAccelerator).toBe("F8");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports persistent registration failure and leaves no retry timer", () => {
    vi.useFakeTimers();
    const logger = { error: vi.fn() };
    const onFailure = vi.fn();
    const globalShortcut = { register: vi.fn(() => false), unregister: vi.fn() };
    const manager: any = {
      hotkeyManager: { getCurrentHotkey: () => "Control+Alt" },
      canRegisterClipboardWithGlobalShortcut: () => true,
      getClipboardHotkeyCallback: () => vi.fn(),
      currentClipboardHotkey: "Fn+F9",
      registeredClipboardAccelerator: "F9",
      debugLogger: logger,
      onClipboardHotkeyRegistrationFailure: onFailure,
    };

    registerClipboardHotkeyInternal(manager, "Fn+F9", { globalShortcut });
    vi.runAllTimers();

    expect(globalShortcut.register).toHaveBeenCalledTimes(
      1 + MAX_CLIPBOARD_REGISTRATION_RETRIES
    );
    expect(manager.clipboardHotkeyRegistrationFailure).toMatchObject({
      hotkey: "Fn+F9",
      attempts: MAX_CLIPBOARD_REGISTRATION_RETRIES,
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(manager.clipboardHotkeyRetryTimer).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
