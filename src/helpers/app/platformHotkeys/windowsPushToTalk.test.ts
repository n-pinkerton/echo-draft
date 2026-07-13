import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";

import pushToTalkModule from "./windowsPushToTalk.js";

const { registerWindowsPushToTalk } = pushToTalkModule as any;

const createPushHarness = () => {
  const ipcMain = new EventEmitter();
  const windowsKeyManager = new EventEmitter() as EventEmitter & {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
  windowsKeyManager.start = vi.fn();
  windowsKeyManager.stop = vi.fn();
  let sessionCounter = 0;
  const controlFrame = { url: "file:///app/index.html?view=control-panel" };
  const controlSender = { mainFrame: controlFrame, getURL: () => controlFrame.url };
  const trustedControlEvent = { sender: controlSender, senderFrame: controlFrame };
  const windowManager = {
    mainWindow: { isDestroyed: () => false, webContents: { send: vi.fn() } },
    controlPanelWindow: {
      __echoDraftTrustedUrl: controlFrame.url,
      webContents: controlSender,
      isDestroyed: () => false,
    },
    getActivationMode: () => "push",
    getCurrentClipboardHotkey: () => "F9",
    shouldUseWindowsNativeListener: () => true,
    clearWindowsNativeListenerReadiness: vi.fn(),
    setWindowsNativeListenerReady: vi.fn(),
    showDictationPanel: vi.fn(),
    hideDictationPanel: vi.fn(),
    createSessionPayload: vi.fn((outputMode: string) => ({
      outputMode,
      sessionId: `session-${++sessionCounter}`,
      triggeredAt: Date.now(),
    })),
    sendStartDictation: vi.fn(),
    sendStopDictation: vi.fn(),
  };
  const controller = registerWindowsPushToTalk({
    ipcMain,
    windowManager,
    hotkeyManager: { getCurrentHotkey: () => "F10" },
    windowsKeyManager,
    debugLogger: { debug: vi.fn(), warn: vi.fn() },
    platform: "win32",
  });
  return { controller, ipcMain, trustedControlEvent, windowManager, windowsKeyManager };
};

describe("registerWindowsPushToTalk", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores untrusted renderer refresh events and accepts the control panel", () => {
    vi.useFakeTimers();
    const { controller, ipcMain, trustedControlEvent, windowsKeyManager } = createPushHarness();

    ipcMain.emit("activation-mode-changed", {}, "push");
    ipcMain.emit("hotkey-changed", {}, "F8");
    expect(windowsKeyManager.start).not.toHaveBeenCalled();

    ipcMain.emit("activation-mode-changed", trustedControlEvent, "push");
    expect(windowsKeyManager.start).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it("clears stale route readiness and restarts a listener after a non-zero exit", async () => {
    vi.useFakeTimers();
    const ipcMain = new EventEmitter();
    const windowsKeyManager = new EventEmitter() as EventEmitter & {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    };
    windowsKeyManager.start = vi.fn();
    windowsKeyManager.stop = vi.fn();

    const setWindowsNativeListenerReady = vi.fn();
    const windowManager = {
      mainWindow: { isDestroyed: () => false },
      controlPanelWindow: null,
      getActivationMode: () => "tap",
      getCurrentClipboardHotkey: () => "F9",
      shouldUseWindowsNativeListener: () => true,
      clearWindowsNativeListenerReadiness: vi.fn(),
      setWindowsNativeListenerReady,
    };
    const hotkeyManager = { getCurrentHotkey: () => "F10" };
    const debugLogger = { debug: vi.fn(), warn: vi.fn() };

    const controller = registerWindowsPushToTalk({
      ipcMain,
      windowManager,
      hotkeyManager,
      windowsKeyManager,
      debugLogger,
      platform: "win32",
    });
    await vi.advanceTimersByTimeAsync(1_251);
    expect(windowsKeyManager.start).toHaveBeenCalledTimes(2);

    windowsKeyManager.emit("ready", { hotkeyId: "insert", key: "F10" });
    expect(setWindowsNativeListenerReady).toHaveBeenLastCalledWith("insert", true);

    windowsKeyManager.emit("route-stopped", {
      hotkeyId: "insert",
      key: "F10",
      reason: "exit",
      code: 1,
    });
    expect(setWindowsNativeListenerReady).toHaveBeenLastCalledWith("insert", false);

    await vi.advanceTimersByTimeAsync(251);
    expect(windowsKeyManager.start).toHaveBeenCalledTimes(4);

    windowsKeyManager.emit("route-stopped", {
      hotkeyId: "insert",
      key: "F10",
      reason: "exit",
      code: 1,
    });
    await vi.advanceTimersByTimeAsync(501);
    expect(windowsKeyManager.start).toHaveBeenCalledTimes(6);

    windowsKeyManager.emit("route-stopped", {
      hotkeyId: "insert",
      key: "F10",
      reason: "exit",
      code: 1,
    });
    await vi.advanceTimersByTimeAsync(1_001);
    expect(windowsKeyManager.start).toHaveBeenCalledTimes(8);

    windowsKeyManager.emit("route-stopped", {
      hotkeyId: "insert",
      key: "F10",
      reason: "exit",
      code: 1,
    });
    await vi.advanceTimersByTimeAsync(2_001);
    expect(windowsKeyManager.start).toHaveBeenCalledTimes(8);
    controller.dispose();
  });

  it.each([
    ["insert", "insert"],
    ["clipboard", "clipboard"],
  ])(
    "force-stops an active %s route exactly once when its listener exits",
    async (hotkeyId, outputMode) => {
      vi.useFakeTimers();
      const { controller, windowManager, windowsKeyManager } = createPushHarness();

      windowsKeyManager.emit("key-down", hotkeyId === "insert" ? "F10" : "F9", hotkeyId);
      await vi.advanceTimersByTimeAsync(151);
      expect(windowManager.sendStartDictation).toHaveBeenCalledTimes(1);
      const startPayload = windowManager.sendStartDictation.mock.calls[0][0];
      expect(startPayload).toMatchObject({ outputMode });

      windowsKeyManager.emit("route-stopped", {
        hotkeyId,
        reason: "exit",
        code: 1,
      });
      expect(windowManager.sendStopDictation).toHaveBeenCalledTimes(1);
      expect(windowManager.sendStopDictation).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: startPayload.sessionId,
          outputMode,
          forcedStopReason: "listener-exit",
        })
      );

      windowsKeyManager.emit("key-up", hotkeyId === "insert" ? "F10" : "F9", hotkeyId);
      expect(windowManager.sendStopDictation).toHaveBeenCalledTimes(1);
      controller.dispose();
    }
  );

  it("suppresses repeated key-down events and sends one start/stop pair", async () => {
    vi.useFakeTimers();
    const { controller, windowManager, windowsKeyManager } = createPushHarness();

    windowsKeyManager.emit("key-down", "F10", "insert");
    windowsKeyManager.emit("key-down", "F10", "insert");
    windowsKeyManager.emit("key-down", "F10", "insert");
    await vi.advanceTimersByTimeAsync(151);

    expect(windowManager.sendStartDictation).toHaveBeenCalledTimes(1);
    windowsKeyManager.emit("key-up", "F10", "insert");
    expect(windowManager.sendStopDictation).toHaveBeenCalledTimes(1);
    expect(windowManager.sendStopDictation.mock.calls[0][0].sessionId).toBe(
      windowManager.sendStartDictation.mock.calls[0][0].sessionId
    );
    controller.dispose();
  });

  it("applies a bounded safety stop to a held push-to-talk route", async () => {
    vi.useFakeTimers();
    const { controller, windowManager, windowsKeyManager } = createPushHarness();
    await vi.advanceTimersByTimeAsync(1_251);

    windowsKeyManager.emit("key-down", "F10", "insert");
    await vi.advanceTimersByTimeAsync(151);
    expect(windowManager.sendStartDictation).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(300_001);
    expect(windowManager.sendStopDictation).toHaveBeenCalledTimes(1);
    expect(windowManager.sendStopDictation).toHaveBeenCalledWith(
      expect.objectContaining({ forcedStopReason: "safety-timeout" })
    );
    controller.dispose();
  });

  it("disposes startup, IPC, and native listeners without later activity", async () => {
    vi.useFakeTimers();
    const { controller, ipcMain, windowManager, windowsKeyManager } = createPushHarness();

    controller.dispose();
    await vi.advanceTimersByTimeAsync(2_000);
    ipcMain.emit("activation-mode-changed", {}, "push");
    windowsKeyManager.emit("key-down", "F10", "insert");
    await vi.advanceTimersByTimeAsync(500);

    expect(windowsKeyManager.start).not.toHaveBeenCalled();
    expect(windowManager.sendStartDictation).not.toHaveBeenCalled();
    expect(ipcMain.listenerCount("activation-mode-changed")).toBe(0);
    expect(ipcMain.listenerCount("hotkey-changed")).toBe(0);
    expect(ipcMain.listenerCount("clipboard-hotkey-changed")).toBe(0);
    expect(windowsKeyManager.listenerCount("key-down")).toBe(0);
    expect(windowsKeyManager.listenerCount("route-stopped")).toBe(0);
  });
});
