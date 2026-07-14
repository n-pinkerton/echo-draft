import { afterEach, describe, expect, it, vi } from "vitest";

import hotkeyRouting from "./hotkeyRouting.js";

const {
  createHotkeyCallback,
  createSessionPayload,
  getMacRequiredModifiers,
  handleMacPushModifierUp,
  sendStartDictation,
  sendStopDictation,
} = hotkeyRouting as any;

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

function setPlatform(value: string) {
  Object.defineProperty(process, "platform", {
    value,
    writable: false,
    enumerable: true,
    configurable: true,
  });
}

describe("hotkeyRouting", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();

    if (originalPlatformDescriptor) {
      Object.defineProperty(process, "platform", originalPlatformDescriptor);
    }
  });

  it("parses required macOS modifiers from hotkeys", () => {
    expect(Array.from(getMacRequiredModifiers("Control+Option+Space")).sort()).toEqual([
      "control",
      "option",
    ]);

    expect(Array.from(getMacRequiredModifiers("Cmd+Shift+Alt+Fn+K")).sort()).toEqual([
      "command",
      "fn",
      "option",
      "shift",
    ]);
  });

  it("creates deterministic session payloads with injected clock/uuid", () => {
    expect(
      createSessionPayload("clipboard", { now: () => 123, randomUUID: () => "uuid-1" })
    ).toEqual({
      outputMode: "clipboard",
      sessionId: "uuid-1",
      triggeredAt: 123,
    });
  });

  it("ignores hotkey triggers while in listening mode", () => {
    const manager: any = {
      hotkeyManager: { isInListeningMode: () => true },
      getActivationMode: () => "tap",
      sendToggleDictation: vi.fn(),
    };

    const callback = createHotkeyCallback(manager, "insert", () => "Control+Alt");
    callback();

    expect(manager.sendToggleDictation).not.toHaveBeenCalled();
  });

  it("blocks starts but always delivers explicit stops while shortcut capture is active", () => {
    const send = vi.fn();
    const manager: any = {
      hotkeyManager: { isInListeningMode: () => true },
      mainWindow: {
        isDestroyed: () => false,
        webContents: { send },
      },
      showDictationPanel: vi.fn(),
    };
    const payload = { outputMode: "insert", sessionId: "active-recording" };

    sendStartDictation(manager, payload);
    sendStopDictation(manager, payload);

    expect(manager.showDictationPanel).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("stop-dictation", payload);
  });

  it("debounces rapid toggle hotkeys", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1000));

    const manager: any = {
      hotkeyManager: { isInListeningMode: () => false },
      getActivationMode: () => "tap",
      sendToggleDictation: vi.fn(),
      createSessionPayload: () => ({ sessionId: "s-1", triggeredAt: 1000 }),
    };

    const callback = createHotkeyCallback(manager, "insert", () => "Control+Alt");

    callback();
    callback();
    expect(manager.sendToggleDictation).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(1100));
    callback();
    expect(manager.sendToggleDictation).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(1200));
    callback();
    expect(manager.sendToggleDictation).toHaveBeenCalledTimes(2);
  });

  it("defers supported Windows tap hotkeys to the ready native repeat-safe route", () => {
    setPlatform("win32");
    const manager: any = {
      hotkeyManager: { isInListeningMode: () => false },
      getActivationMode: () => "tap",
      shouldUseWindowsNativeListener: () => true,
      isWindowsNativeListenerReady: (routeId: string) => routeId === "insert",
      sendToggleDictation: vi.fn(),
      createSessionPayload: vi.fn(),
    };

    const callback = createHotkeyCallback(manager, "insert", () => "F10");
    callback();

    expect(manager.sendToggleDictation).not.toHaveBeenCalled();
    expect(manager.createSessionPayload).not.toHaveBeenCalled();
  });

  it("uses the global toggle fallback in push mode while the native route is unavailable", () => {
    setPlatform("win32");
    const payload = { outputMode: "clipboard", sessionId: "fallback-1", triggeredAt: 1000 };
    const manager: any = {
      hotkeyManager: { isInListeningMode: () => false },
      getActivationMode: () => "push",
      shouldUseWindowsNativeListener: () => true,
      isWindowsNativeListenerReady: () => false,
      sendToggleDictation: vi.fn(),
      createSessionPayload: vi.fn(() => payload),
    };

    const callback = createHotkeyCallback(manager, "clipboard", () => "F9");
    callback();

    expect(manager.sendToggleDictation).toHaveBeenCalledWith(payload);
  });

  it("starts macOS compound push-to-talk when activation mode is push", () => {
    setPlatform("darwin");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1000));

    const payload = { outputMode: "insert", sessionId: "s-1", triggeredAt: 1000 };
    const manager: any = {
      macCompoundPushState: null,
      windowsPushToTalkAvailable: false,
      hotkeyManager: { isInListeningMode: () => false },
      getActivationMode: () => "push",
      createSessionPayload: () => payload,
      showDictationPanel: vi.fn(),
      hideDictationPanel: vi.fn(),
      sendStartDictation: vi.fn(),
      sendStopDictation: vi.fn(),
      sendToggleDictation: vi.fn(),
      mainWindow: null,
    };

    const callback = createHotkeyCallback(manager, "insert", () => "Control+Option+Space");
    callback();

    expect(manager.showDictationPanel).toHaveBeenCalledTimes(1);
    expect(manager.sendToggleDictation).not.toHaveBeenCalled();
    expect(manager.macCompoundPushState?.active).toBe(true);

    vi.advanceTimersByTime(151);
    expect(manager.sendStartDictation).toHaveBeenCalledTimes(1);
    expect(manager.sendStartDictation).toHaveBeenCalledWith(payload);

    handleMacPushModifierUp(manager, "control");
    expect(manager.sendStopDictation).toHaveBeenCalledTimes(1);
    expect(manager.sendStopDictation).toHaveBeenCalledWith(payload);
    expect(manager.macCompoundPushState).toBe(null);
  });
});
