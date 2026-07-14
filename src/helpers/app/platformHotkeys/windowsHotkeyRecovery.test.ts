import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

import recoveryModule from "./windowsHotkeyRecovery.js";

const { registerWindowsHotkeyRecovery } = recoveryModule as any;

describe("registerWindowsHotkeyRecovery", () => {
  it("retries a failed insert registration and stops after success", async () => {
    vi.useFakeTimers();
    const powerMonitor = new EventEmitter();
    const recoverHotkeys = vi
      .fn()
      .mockResolvedValueOnce({ insert: { success: false }, clipboard: { success: true } })
      .mockResolvedValueOnce({ insert: { success: true }, clipboard: { success: true } });
    const refreshWindowsKeyListeners = vi.fn();
    const forceStopActiveRoutes = vi.fn();
    const refreshControlPanelShortcut = vi.fn(() => ({ registered: true }));
    const onInsertHotkeyRegistrationFailure = vi.fn();

    const dispose = registerWindowsHotkeyRecovery({
      powerMonitor,
      windowManager: { recoverHotkeys, onInsertHotkeyRegistrationFailure },
      windowsHotkeyController: { forceStopActiveRoutes, refreshWindowsKeyListeners },
      controlPanelShortcutRegistration: { refresh: refreshControlPanelShortcut },
      debugLogger: { debug: vi.fn(), warn: vi.fn() },
      platform: "win32",
      delayMs: 10,
      retryDelayMs: 20,
    });

    powerMonitor.emit("resume");
    await vi.advanceTimersByTimeAsync(31);

    expect(recoverHotkeys).toHaveBeenCalledTimes(2);
    expect(forceStopActiveRoutes).toHaveBeenCalledTimes(1);
    expect(forceStopActiveRoutes).toHaveBeenCalledWith("system-resume");
    expect(refreshWindowsKeyListeners).toHaveBeenCalledTimes(1);
    expect(refreshControlPanelShortcut).toHaveBeenCalledWith("system-resume");
    expect(onInsertHotkeyRegistrationFailure).not.toHaveBeenCalled();
    expect(forceStopActiveRoutes.mock.invocationCallOrder[0]).toBeLessThan(
      recoverHotkeys.mock.invocationCallOrder[0]
    );
    expect(recoverHotkeys.mock.invocationCallOrder[1]).toBeLessThan(
      refreshWindowsKeyListeners.mock.invocationCallOrder[0]
    );

    dispose();
    vi.useRealTimers();
  });

  it("notifies once after the final insert registration failure", async () => {
    vi.useFakeTimers();
    const powerMonitor = new EventEmitter();
    const failure = { success: false, hotkey: "F8", message: "Unavailable" };
    const recoverHotkeys = vi.fn(async () => ({
      insert: failure,
      clipboard: { success: true },
    }));
    const onInsertHotkeyRegistrationFailure = vi.fn();

    const dispose = registerWindowsHotkeyRecovery({
      powerMonitor,
      windowManager: { recoverHotkeys, onInsertHotkeyRegistrationFailure },
      windowsHotkeyController: {
        forceStopActiveRoutes: vi.fn(),
        refreshWindowsKeyListeners: vi.fn(),
      },
      controlPanelShortcutRegistration: { refresh: vi.fn(() => ({ registered: true })) },
      debugLogger: { debug: vi.fn(), warn: vi.fn() },
      platform: "win32",
      delayMs: 10,
      retryDelayMs: 20,
    });

    powerMonitor.emit("resume");
    await vi.advanceTimersByTimeAsync(51);

    expect(recoverHotkeys).toHaveBeenCalledTimes(3);
    expect(onInsertHotkeyRegistrationFailure).toHaveBeenCalledTimes(1);
    expect(onInsertHotkeyRegistrationFailure).toHaveBeenCalledWith(failure);

    dispose();
    vi.useRealTimers();
  });

  it("debounces resume and unlock into one recovery with the latest reason", async () => {
    vi.useFakeTimers();
    const powerMonitor = new EventEmitter();
    const recoverHotkeys = vi.fn(async () => ({ insert: { success: true } }));
    const forceStopActiveRoutes = vi.fn();

    const dispose = registerWindowsHotkeyRecovery({
      powerMonitor,
      windowManager: { recoverHotkeys },
      windowsHotkeyController: { forceStopActiveRoutes, refreshWindowsKeyListeners: vi.fn() },
      controlPanelShortcutRegistration: { refresh: vi.fn() },
      debugLogger: { debug: vi.fn(), warn: vi.fn() },
      platform: "win32",
      delayMs: 10,
      retryDelayMs: 20,
    });

    powerMonitor.emit("resume");
    powerMonitor.emit("unlock-screen");
    await vi.advanceTimersByTimeAsync(11);

    expect(recoverHotkeys).toHaveBeenCalledTimes(1);
    expect(forceStopActiveRoutes).toHaveBeenCalledWith("system-unlock-screen");

    dispose();
    vi.useRealTimers();
  });

  it("does not restore global or native shortcuts while hotkey capture is active", async () => {
    vi.useFakeTimers();
    const powerMonitor = new EventEmitter();
    const recoverHotkeys = vi.fn(async () => ({ insert: { success: true } }));
    const refreshWindowsKeyListeners = vi.fn();
    const refreshControlPanel = vi.fn();

    const dispose = registerWindowsHotkeyRecovery({
      powerMonitor,
      windowManager: {
        hotkeyManager: { isInListeningMode: () => true },
        recoverHotkeys,
      },
      windowsHotkeyController: {
        forceStopActiveRoutes: vi.fn(),
        refreshWindowsKeyListeners,
      },
      controlPanelShortcutRegistration: { refresh: refreshControlPanel },
      debugLogger: { debug: vi.fn(), warn: vi.fn() },
      platform: "win32",
      delayMs: 10,
      retryDelayMs: 20,
    });

    powerMonitor.emit("resume");
    powerMonitor.emit("unlock-screen");
    await vi.advanceTimersByTimeAsync(50);

    expect(recoverHotkeys).not.toHaveBeenCalled();
    expect(refreshWindowsKeyListeners).not.toHaveBeenCalled();
    expect(refreshControlPanel).not.toHaveBeenCalled();
    dispose();
    vi.useRealTimers();
  });

  it("cancels pending debounce and retry timers on disposal", async () => {
    vi.useFakeTimers();
    const powerMonitor = new EventEmitter();
    const recoverHotkeys = vi.fn(async () => ({ insert: { success: false } }));

    const disposeDebounce = registerWindowsHotkeyRecovery({
      powerMonitor,
      windowManager: { recoverHotkeys },
      platform: "win32",
      delayMs: 10,
      retryDelayMs: 20,
    });
    powerMonitor.emit("resume");
    disposeDebounce();
    await vi.runAllTimersAsync();
    expect(recoverHotkeys).not.toHaveBeenCalled();

    const disposeRetry = registerWindowsHotkeyRecovery({
      powerMonitor,
      windowManager: { recoverHotkeys },
      platform: "win32",
      delayMs: 10,
      retryDelayMs: 20,
    });
    powerMonitor.emit("resume");
    await vi.advanceTimersByTimeAsync(11);
    expect(recoverHotkeys).toHaveBeenCalledTimes(1);
    disposeRetry();
    await vi.runAllTimersAsync();
    expect(recoverHotkeys).toHaveBeenCalledTimes(1);

    expect(powerMonitor.listenerCount("resume")).toBe(0);
    expect(powerMonitor.listenerCount("unlock-screen")).toBe(0);
    vi.useRealTimers();
  });
});
