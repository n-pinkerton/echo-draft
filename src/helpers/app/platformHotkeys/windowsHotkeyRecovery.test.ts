import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

import recoveryModule from "./windowsHotkeyRecovery.js";

const { registerWindowsHotkeyRecovery } = recoveryModule as any;

describe("registerWindowsHotkeyRecovery", () => {
  it("debounces resume/unlock events and refreshes global and native routes", async () => {
    vi.useFakeTimers();
    const powerMonitor = new EventEmitter();
    const recoverHotkeys = vi.fn(async () => ({ insert: { success: true } }));
    const refreshWindowsKeyListeners = vi.fn();
    const forceStopActiveRoutes = vi.fn();

    const dispose = registerWindowsHotkeyRecovery({
      powerMonitor,
      windowManager: { recoverHotkeys },
      windowsHotkeyController: { forceStopActiveRoutes, refreshWindowsKeyListeners },
      debugLogger: { debug: vi.fn(), warn: vi.fn() },
      platform: "win32",
      delayMs: 10,
    });

    powerMonitor.emit("resume");
    powerMonitor.emit("unlock-screen");
    await vi.advanceTimersByTimeAsync(11);

    expect(recoverHotkeys).toHaveBeenCalledTimes(1);
    expect(forceStopActiveRoutes).toHaveBeenCalledTimes(1);
    expect(forceStopActiveRoutes).toHaveBeenCalledWith("system-unlock-screen");
    expect(refreshWindowsKeyListeners).toHaveBeenCalledTimes(1);
    expect(refreshWindowsKeyListeners).toHaveBeenCalledWith({ reason: "system-unlock-screen" });
    expect(forceStopActiveRoutes.mock.invocationCallOrder[0]).toBeLessThan(
      recoverHotkeys.mock.invocationCallOrder[0]
    );

    dispose();
    expect(powerMonitor.listenerCount("resume")).toBe(0);
    expect(powerMonitor.listenerCount("unlock-screen")).toBe(0);
    vi.useRealTimers();
  });
});
