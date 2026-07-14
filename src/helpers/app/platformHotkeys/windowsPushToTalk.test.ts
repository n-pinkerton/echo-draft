import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";

import pushToTalkModule from "./windowsPushToTalk.js";

const { registerWindowsPushToTalk } = pushToTalkModule as any;

const createPushHarness = () => {
  const ipcMain = new EventEmitter();
  const windowsKeyManager = new EventEmitter() as EventEmitter & {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    stopAndWait: ReturnType<typeof vi.fn>;
  };
  windowsKeyManager.start = vi.fn();
  windowsKeyManager.stop = vi.fn();
  windowsKeyManager.stopAndWait = vi.fn(async () => true);
  let captureActive = false;
  let sessionCounter = 0;
  const controlFrame = { url: "file:///app/index.html?view=control-panel" };
  const controlSender = { mainFrame: controlFrame, getURL: () => controlFrame.url, send: vi.fn() };
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
    canUseWindowsRegisteredTapHotkey: () => true,
    suspendGlobalHotkeyForNativeTap: vi.fn(),
    restoreGlobalHotkeyFallback: vi.fn((_hotkeyId: string) => ({ success: true })),
    onClipboardHotkeyRegistrationFailure: vi.fn(),
    onInsertHotkeyRegistrationFailure: vi.fn(),
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
  const hotkeyManager = {
    getCurrentHotkey: () => "F10",
    isInListeningMode: () => captureActive,
  };
  const controller = registerWindowsPushToTalk({
    ipcMain,
    windowManager,
    hotkeyManager,
    windowsKeyManager,
    debugLogger: { debug: vi.fn(), warn: vi.fn() },
    platform: "win32",
  });
  return {
    controller,
    ipcMain,
    setCaptureActive: (active: boolean) => {
      captureActive = active;
    },
    trustedControlEvent,
    windowManager,
    windowsKeyManager,
  };
};

describe("registerWindowsPushToTalk", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores untrusted renderer refresh events and accepts the control panel", async () => {
    vi.useFakeTimers();
    const { controller, ipcMain, trustedControlEvent, windowsKeyManager } = createPushHarness();

    ipcMain.emit("activation-mode-changed", {}, "push");
    ipcMain.emit("hotkey-changed", {}, "F8");
    expect(windowsKeyManager.start).not.toHaveBeenCalled();

    ipcMain.emit("activation-mode-changed", trustedControlEvent, "push");
    await vi.advanceTimersByTimeAsync(0);
    expect(windowsKeyManager.start).toHaveBeenCalledTimes(2);

    controller.dispose();
  });

  it("keeps startup refresh and native key events inert while capture is active", async () => {
    vi.useFakeTimers();
    const { controller, setCaptureActive, windowManager, windowsKeyManager } = createPushHarness();
    setCaptureActive(true);

    await vi.advanceTimersByTimeAsync(1_251);
    windowsKeyManager.emit("key-down", "F10", "insert");
    await vi.advanceTimersByTimeAsync(200);

    expect(windowsKeyManager.stopAndWait).toHaveBeenCalled();
    expect(windowsKeyManager.start).not.toHaveBeenCalled();
    expect(windowManager.sendStartDictation).not.toHaveBeenCalled();

    setCaptureActive(false);
    await controller.refreshWindowsKeyListeners({ reason: "hotkey-capture-exit" });
    expect(windowsKeyManager.start).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("does not start a replacement until an unconfirmed helper exit is later confirmed", async () => {
    vi.useFakeTimers();
    const { controller, windowManager, windowsKeyManager } = createPushHarness();
    windowsKeyManager.stopAndWait.mockResolvedValueOnce(false).mockResolvedValue(true);

    await controller.refreshWindowsKeyListeners({ reason: "test-replacement" });
    expect(windowsKeyManager.start).not.toHaveBeenCalled();
    expect(windowManager.mainWindow.webContents.send).toHaveBeenCalledWith(
      "windows-ptt-unavailable",
      expect.objectContaining({ reason: "listener_shutdown_pending" })
    );
    expect(windowManager.mainWindow.webContents.send).toHaveBeenCalledWith(
      "windows-ptt-unavailable",
      expect.objectContaining({ recoveryPending: true })
    );

    windowsKeyManager.emit("retirement-confirmed", { hotkeyId: "insert" });
    await vi.advanceTimersByTimeAsync(0);

    expect(windowsKeyManager.stopAndWait).toHaveBeenCalledTimes(2);
    expect(windowsKeyManager.start).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("clears stale route readiness and restarts a listener after a non-zero exit", async () => {
    vi.useFakeTimers();
    const ipcMain = new EventEmitter();
    const windowsKeyManager = new EventEmitter() as EventEmitter & {
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      stopAndWait: ReturnType<typeof vi.fn>;
    };
    windowsKeyManager.start = vi.fn();
    windowsKeyManager.stop = vi.fn();
    windowsKeyManager.stopAndWait = vi.fn(async () => true);

    const setWindowsNativeListenerReady = vi.fn();
    const windowManager = {
      mainWindow: { isDestroyed: () => false, webContents: { send: vi.fn() } },
      controlPanelWindow: null,
      getActivationMode: () => "tap",
      getCurrentClipboardHotkey: () => "F9",
      shouldUseWindowsNativeListener: () => true,
      canUseWindowsRegisteredTapHotkey: () => true,
      suspendGlobalHotkeyForNativeTap: vi.fn(),
      restoreGlobalHotkeyFallback: vi.fn(() => ({ success: true })),
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
    expect(windowManager.suspendGlobalHotkeyForNativeTap).toHaveBeenCalledTimes(2);
    expect(windowsKeyManager.start).toHaveBeenCalledWith("F10", "insert", { mode: "tap" });
    expect(windowsKeyManager.start).toHaveBeenCalledWith("F9", "clipboard", { mode: "tap" });

    windowsKeyManager.emit("ready", { hotkeyId: "insert", key: "F10" });
    expect(setWindowsNativeListenerReady).toHaveBeenLastCalledWith("insert", true);

    windowsKeyManager.emit("route-stopped", {
      hotkeyId: "insert",
      key: "F10",
      reason: "exit",
      code: 1,
      mode: "tap",
    });
    expect(setWindowsNativeListenerReady).toHaveBeenLastCalledWith("insert", false);
    expect(windowManager.restoreGlobalHotkeyFallback).toHaveBeenCalledWith("insert");
    expect(windowManager.mainWindow.webContents.send).toHaveBeenCalledWith(
      "windows-ptt-unavailable",
      expect.objectContaining({
        reason: "listener_exited",
        routeId: "insert",
        fallbackActive: true,
        recoveryPending: true,
      })
    );
    expect(windowManager.mainWindow.webContents.send.mock.calls.flat()).not.toContain(
      expect.stringContaining("code 1")
    );

    await vi.advanceTimersByTimeAsync(251);
    expect(windowsKeyManager.start).toHaveBeenCalledTimes(4);
    windowsKeyManager.emit("ready", { hotkeyId: "insert", key: "F10", mode: "tap" });
    expect(windowManager.mainWindow.webContents.send).toHaveBeenCalledWith(
      "windows-ptt-recovered",
      expect.objectContaining({ routeId: "insert" })
    );

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

  it("retries the insert global fallback while Windows releases a failed native route", async () => {
    vi.useFakeTimers();
    const { controller, windowManager, windowsKeyManager } = createPushHarness();
    windowManager.getActivationMode = () => "tap";
    let insertAttempts = 0;
    windowManager.restoreGlobalHotkeyFallback.mockImplementation((hotkeyId: string) => {
      if (hotkeyId !== "insert") return { success: true };
      insertAttempts += 1;
      return insertAttempts < 3
        ? { success: false, error: "still owned by terminating helper" }
        : { success: true };
    });

    await vi.advanceTimersByTimeAsync(1_251);
    windowManager.shouldUseWindowsNativeListener = () => false;
    windowsKeyManager.emit("error", new Error("listener failed"));
    expect(insertAttempts).toBe(1);
    expect(windowManager.onInsertHotkeyRegistrationFailure).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(insertAttempts).toBe(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(insertAttempts).toBe(3);
    expect(windowManager.onInsertHotkeyRegistrationFailure).not.toHaveBeenCalled();

    controller.dispose();
  });

  it("reports an insert fallback only after its bounded retries are exhausted", async () => {
    vi.useFakeTimers();
    const { controller, windowManager, windowsKeyManager } = createPushHarness();
    windowManager.getActivationMode = () => "tap";
    windowManager.restoreGlobalHotkeyFallback.mockImplementation((hotkeyId: string) =>
      hotkeyId === "insert" ? { success: false, error: "shortcut unavailable" } : { success: true }
    );

    await vi.advanceTimersByTimeAsync(1_251);
    windowManager.shouldUseWindowsNativeListener = () => false;
    windowsKeyManager.emit("error", new Error("listener failed"));
    await vi.advanceTimersByTimeAsync(850);

    expect(windowManager.restoreGlobalHotkeyFallback).toHaveBeenCalledTimes(5);
    expect(windowManager.onInsertHotkeyRegistrationFailure).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("reports missing-listener fallback without claiming a pending retry", async () => {
    vi.useFakeTimers();
    const { controller, windowManager, windowsKeyManager } = createPushHarness();
    await vi.advanceTimersByTimeAsync(1_251);

    windowsKeyManager.emit("unavailable", new Error("missing"), { hotkeyId: "insert" });

    expect(windowManager.mainWindow.webContents.send).toHaveBeenLastCalledWith(
      "windows-ptt-unavailable",
      expect.objectContaining({
        routeId: "insert",
        reason: "binary_not_found",
        recoveryPending: false,
        unavailableRoutes: [expect.objectContaining({ routeId: "insert", recoveryPending: false })],
      })
    );
    controller.dispose();
  });

  it("publishes the complete affected-route set when both listeners fail", async () => {
    vi.useFakeTimers();
    const { controller, windowManager, windowsKeyManager } = createPushHarness();
    await vi.advanceTimersByTimeAsync(1_251);

    windowsKeyManager.emit("error", new Error("listener failed"));

    expect(windowManager.mainWindow.webContents.send).toHaveBeenLastCalledWith(
      "windows-ptt-unavailable",
      expect.objectContaining({
        routeId: "clipboard",
        recoveryPending: true,
        unavailableRoutes: expect.arrayContaining([
          expect.objectContaining({ routeId: "insert", recoveryPending: true }),
          expect.objectContaining({ routeId: "clipboard", recoveryPending: true }),
        ]),
      })
    );
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

  it.each([
    ["insert", "clipboard", true],
    ["insert", "clipboard", false],
    ["clipboard", "insert", true],
    ["clipboard", "insert", false],
  ])(
    "lets only the accepted %s push route stop when %s overlaps (suppressed first: %s)",
    async (activeRoute, suppressedRoute, releaseSuppressedFirst) => {
      vi.useFakeTimers();
      const { controller, windowManager, windowsKeyManager } = createPushHarness();
      const keyFor = (route: string) => (route === "insert" ? "F10" : "F9");

      windowsKeyManager.emit("key-down", keyFor(activeRoute), activeRoute);
      windowsKeyManager.emit("key-down", keyFor(suppressedRoute), suppressedRoute);
      await vi.advanceTimersByTimeAsync(151);

      expect(windowManager.sendStartDictation).toHaveBeenCalledTimes(1);
      expect(windowManager.sendStartDictation).toHaveBeenCalledWith(
        expect.objectContaining({ outputMode: activeRoute })
      );

      const release = (route: string) =>
        windowsKeyManager.emit("key-up", keyFor(route), route);
      if (releaseSuppressedFirst) {
        release(suppressedRoute);
        expect(windowManager.sendStopDictation).not.toHaveBeenCalled();
        release(activeRoute);
      } else {
        release(activeRoute);
        release(suppressedRoute);
      }

      expect(windowManager.sendStopDictation).toHaveBeenCalledTimes(1);
      expect(windowManager.sendStopDictation).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: windowManager.sendStartDictation.mock.calls[0][0].sessionId,
          outputMode: activeRoute,
        })
      );
      controller.dispose();
    }
  );

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
