const { isLiveWindow } = require("../windowUtils");

function registerWindowsPushToTalk({
  ipcMain,
  windowManager,
  hotkeyManager,
  windowsKeyManager,
  debugLogger,
  platform = process.platform,
} = {}) {
  if (platform !== "win32") {
    return null;
  }

  if (!ipcMain || !windowManager || !hotkeyManager || !windowsKeyManager || !debugLogger) {
    throw new Error("registerWindowsPushToTalk missing required dependencies");
  }

  debugLogger.debug("[Push-to-Talk] Windows Push-to-Talk setup starting");

  // Minimum duration (ms) the key must be held before starting recording.
  // This distinguishes a "tap" (ignored in push mode) from a "hold" (starts recording).
  // 150ms is short enough to feel instant but long enough to detect intent.
  const MIN_HOLD_DURATION_MS = 150;

  const keyStates = {
    insert: { downTime: 0, isRecording: false, payload: null },
    clipboard: { downTime: 0, isRecording: false, payload: null },
  };

  const getRouteState = (hotkeyId = "insert") =>
    hotkeyId === "clipboard" ? keyStates.clipboard : keyStates.insert;
  const getOutputMode = (hotkeyId = "insert") => (hotkeyId === "clipboard" ? "clipboard" : "insert");
  const resetRouteState = (hotkeyId = "insert") => {
    const state = getRouteState(hotkeyId);
    state.downTime = 0;
    state.isRecording = false;
    state.payload = null;
  };

  const refreshWindowsKeyListeners = (modeOverride = null) => {
    if (!isLiveWindow(windowManager.mainWindow)) return;

    const activationMode = modeOverride || windowManager.getActivationMode();
    const insertHotkey = hotkeyManager.getCurrentHotkey();
    const clipboardHotkey = windowManager.getCurrentClipboardHotkey
      ? windowManager.getCurrentClipboardHotkey()
      : null;
    const startedHotkeys = new Set();

    windowsKeyManager.stop();
    windowManager.setWindowsPushToTalkAvailable(false);

    const maybeStartRoute = (hotkey, routeId) => {
      if (!hotkey || hotkey === "GLOBE" || startedHotkeys.has(hotkey)) {
        return;
      }
      if (!windowManager.shouldUseWindowsNativeListener(hotkey, activationMode)) {
        return;
      }
      debugLogger.debug("[Push-to-Talk] Starting Windows key listener route", {
        routeId,
        hotkey,
        activationMode,
      });
      windowsKeyManager.start(hotkey, routeId);
      startedHotkeys.add(hotkey);
    };

    maybeStartRoute(insertHotkey, "insert");
    maybeStartRoute(clipboardHotkey, "clipboard");

    if (startedHotkeys.size === 0) {
      debugLogger.debug("[Push-to-Talk] Native listeners not required for current hotkeys", {
        activationMode,
        insertHotkey,
        clipboardHotkey,
      });
    }
  };

  windowsKeyManager.on("key-down", (key, hotkeyId = "insert") => {
    debugLogger.debug("[Push-to-Talk] Key DOWN received", { key, hotkeyId });
    if (!isLiveWindow(windowManager.mainWindow)) return;

    const activationMode = windowManager.getActivationMode();
    const routeState = getRouteState(hotkeyId);
    const outputMode = getOutputMode(hotkeyId);
    debugLogger.debug("[Push-to-Talk] Activation mode check", { activationMode, hotkeyId, outputMode });

    if (activationMode === "push") {
      debugLogger.debug("[Push-to-Talk] Starting recording sequence", { hotkeyId, outputMode });
      windowManager.showDictationPanel();
      routeState.downTime = Date.now();
      routeState.isRecording = false;
      routeState.payload = windowManager.createSessionPayload(outputMode);
      debugLogger.debug("[Push-to-Talk] Session payload created", {
        hotkeyId,
        outputMode,
        sessionId: routeState.payload?.sessionId,
        payload: routeState.payload,
      });

      setTimeout(() => {
        if (routeState.downTime > 0 && !routeState.isRecording) {
          routeState.isRecording = true;
          const startPayload = { ...routeState.payload, startedAt: Date.now() };
          routeState.payload = startPayload;
          debugLogger.debug("[Push-to-Talk] Sending start dictation command", {
            hotkeyId,
            outputMode,
            sessionId: startPayload?.sessionId,
            holdMs: Math.max(0, Date.now() - routeState.downTime),
          });
          windowManager.sendStartDictation(startPayload);
        }
      }, MIN_HOLD_DURATION_MS);
    } else if (activationMode === "tap") {
      windowManager.showDictationPanel();
      windowManager.sendToggleDictation(windowManager.createSessionPayload(outputMode));
    }
  });

  windowsKeyManager.on("key-up", (key, hotkeyId = "insert") => {
    debugLogger.debug("[Push-to-Talk] Key UP received", { key, hotkeyId });
    if (!isLiveWindow(windowManager.mainWindow)) return;

    const activationMode = windowManager.getActivationMode();
    if (activationMode === "push") {
      const routeState = getRouteState(hotkeyId);
      const wasRecording = routeState.isRecording;
      const payload = routeState.payload ? { ...routeState.payload, releasedAt: Date.now() } : null;
      resetRouteState(hotkeyId);
      if (wasRecording) {
        debugLogger.debug("[Push-to-Talk] Sending stop dictation command", {
          hotkeyId,
          sessionId: payload?.sessionId,
        });
        if (payload) {
          windowManager.sendStopDictation(payload);
        }
      } else {
        debugLogger.debug("[Push-to-Talk] Short tap detected, hiding panel", {
          hotkeyId,
          sessionId: payload?.sessionId,
        });
        windowManager.hideDictationPanel();
      }
    }
  });

  windowsKeyManager.on("error", (error) => {
    debugLogger.warn("[Push-to-Talk] Windows key listener error", { error: error.message });
    windowManager.setWindowsPushToTalkAvailable(false);
    const payload = {
      reason: "error",
      message: error.message,
    };
    if (isLiveWindow(windowManager.mainWindow)) {
      windowManager.mainWindow.webContents.send("windows-ptt-unavailable", payload);
    }
    if (isLiveWindow(windowManager.controlPanelWindow)) {
      windowManager.controlPanelWindow.webContents.send("windows-ptt-unavailable", payload);
    }
  });

  windowsKeyManager.on("unavailable", () => {
    debugLogger.debug(
      "[Push-to-Talk] Windows key listener not available - falling back to toggle mode"
    );
    windowManager.setWindowsPushToTalkAvailable(false);
    const payload = {
      reason: "binary_not_found",
      message: "Push-to-Talk native listener not available",
    };
    if (isLiveWindow(windowManager.mainWindow)) {
      windowManager.mainWindow.webContents.send("windows-ptt-unavailable", payload);
    }
    if (isLiveWindow(windowManager.controlPanelWindow)) {
      windowManager.controlPanelWindow.webContents.send("windows-ptt-unavailable", payload);
    }
  });

  windowsKeyManager.on("ready", (info) => {
    debugLogger.debug("[Push-to-Talk] WindowsKeyManager route ready", info);
    windowManager.setWindowsPushToTalkAvailable(true);
  });

  const STARTUP_DELAY_MS = 3000;
  debugLogger.debug("[Push-to-Talk] Scheduling listener startup refresh", { delayMs: STARTUP_DELAY_MS });
  setTimeout(() => {
    try {
      refreshWindowsKeyListeners();
    } catch (error) {
      debugLogger.warn("[Push-to-Talk] Failed to refresh listeners on startup", {
        error: error?.message || String(error),
      });
    }
  }, STARTUP_DELAY_MS);

  // Listen for activation mode changes from renderer
  ipcMain.on("activation-mode-changed", (_event, mode) => {
    debugLogger.debug("[Push-to-Talk] IPC: Activation mode changed", { mode });
    refreshWindowsKeyListeners(mode);
  });

  // Listen for hotkey changes from renderer
  ipcMain.on("hotkey-changed", (_event, hotkey) => {
    debugLogger.debug("[Push-to-Talk] IPC: Hotkey changed", { hotkey });
    resetRouteState("insert");
    refreshWindowsKeyListeners();
  });

  ipcMain.on("clipboard-hotkey-changed", (_event, hotkey) => {
    debugLogger.debug("[Push-to-Talk] IPC: Clipboard hotkey changed", { hotkey });
    resetRouteState("clipboard");
    refreshWindowsKeyListeners();
  });

  return {
    refreshWindowsKeyListeners,
    resetRouteState,
  };
}

module.exports = {
  registerWindowsPushToTalk,
};

