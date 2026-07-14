import { describe, expect, it, vi } from "vitest";

import lifecycleModule from "./hotkeyCaptureLifecycle.js";

const { setHotkeyCaptureMode } = lifecycleModule as any;

function createHarness() {
  let listening = false;
  let insertHotkey = "F10";
  const refreshWindowsKeyListeners = vi.fn(async () => undefined);
  const controller = { refreshWindowsKeyListeners };
  const windowsKeyManager = {
    start: vi.fn(),
    stop: vi.fn(),
    stopAndWait: vi.fn(async () => true),
  };
  const recoverHotkeys = vi.fn(async () => ({
    insert: { success: true, hotkey: insertHotkey },
    clipboard: { success: true, hotkey: "F9" },
  }));
  const hotkeyManager = {
    getCurrentHotkey: () => insertHotkey,
    isInListeningMode: () => listening,
    isUsingGnome: () => false,
  };
  const windowManager = {
    hotkeyManager,
    createSessionPayload: vi.fn((outputMode: string) => ({
      outputMode,
      sessionId: "capture-safety-stop",
    })),
    getCurrentClipboardHotkey: () => "F9",
    getWindowsHotkeyController: () => controller,
    sendStopDictation: vi.fn(),
    setHotkeyListeningMode: (enabled: boolean) => {
      listening = enabled;
    },
    recoverHotkeys,
  };
  const globalShortcut = {
    unregister: vi.fn(),
    register: vi.fn(() => true),
    isRegistered: vi.fn(() => false),
  };
  return {
    controller,
    globalShortcut,
    refreshWindowsKeyListeners,
    recoverHotkeys,
    setInsertHotkey: (value: string) => {
      insertHotkey = value;
    },
    windowManager,
    windowsKeyManager,
  };
}

describe("setHotkeyCaptureMode", () => {
  it("keeps Windows native ownership in the lifecycle controller across focus and blur", async () => {
    const harness = createHarness();

    await setHotkeyCaptureMode(
      { enabled: true, target: "insert" },
      { ...harness, platform: "win32" }
    );
    await setHotkeyCaptureMode(
      { enabled: false, newHotkey: "F11", target: "insert" },
      { ...harness, platform: "win32" }
    );

    expect(harness.refreshWindowsKeyListeners).toHaveBeenNthCalledWith(1, {
      reason: "hotkey-capture-enter",
    });
    expect(harness.refreshWindowsKeyListeners).toHaveBeenNthCalledWith(2, {
      reason: "hotkey-capture-exit",
    });
    expect(harness.recoverHotkeys).toHaveBeenCalledOnce();
    expect(harness.windowsKeyManager.start).not.toHaveBeenCalled();
    expect(harness.windowsKeyManager.stop).not.toHaveBeenCalled();
    expect(harness.windowsKeyManager.stopAndWait).not.toHaveBeenCalled();
  });

  it("safety-stops a live recording before removing shortcut ownership", async () => {
    const harness = createHarness();

    await setHotkeyCaptureMode(
      { enabled: true, target: "clipboard" },
      { ...harness, platform: "win32" }
    );

    expect(harness.windowManager.sendStopDictation).toHaveBeenCalledWith({
      outputMode: "clipboard",
      sessionId: "capture-safety-stop",
      forcedStopReason: "hotkey-capture",
    });
    expect(harness.windowManager.sendStopDictation.mock.invocationCallOrder[0]).toBeLessThan(
      harness.refreshWindowsKeyListeners.mock.invocationCallOrder[0]
    );
    expect(harness.refreshWindowsKeyListeners.mock.invocationCallOrder[0]).toBeLessThan(
      harness.globalShortcut.unregister.mock.invocationCallOrder[0]
    );
  });

  it("recovers the accepted manager value rather than an unaccepted capture candidate", async () => {
    const harness = createHarness();

    await setHotkeyCaptureMode(
      { enabled: false, newHotkey: "F11", target: "insert" },
      { ...harness, platform: "win32" }
    );

    expect(await harness.recoverHotkeys.mock.results[0].value).toEqual(
      expect.objectContaining({ insert: expect.objectContaining({ hotkey: "F10" }) })
    );
    expect(harness.windowsKeyManager.start).not.toHaveBeenCalled();
  });

  it("fails closed when capture begins before the Windows controller is available", async () => {
    const harness = createHarness();
    harness.windowManager.getWindowsHotkeyController = () => null;

    await setHotkeyCaptureMode(
      { enabled: true, target: "insert" },
      { ...harness, platform: "win32" }
    );

    expect(harness.windowsKeyManager.stopAndWait).toHaveBeenCalledOnce();
    expect(harness.windowsKeyManager.start).not.toHaveBeenCalled();
  });
});
