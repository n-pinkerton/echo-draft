const { isLiveWindow } = require("../windowUtils");
const { requireTrustedRenderer } = require("../../ipc/trustedRenderer");

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
  const MAX_PUSH_DURATION_MS = 300_000;

  const keyStates = {
    insert: {
      downTime: 0,
      isRecording: false,
      payload: null,
      holdTimer: null,
      safetyTimer: null,
    },
    clipboard: {
      downTime: 0,
      isRecording: false,
      payload: null,
      holdTimer: null,
      safetyTimer: null,
    },
  };
  const unexpectedExitAttempts = new Map();
  const unexpectedExitTimers = new Map();
  const stableRouteTimers = new Map();
  const MAX_UNEXPECTED_EXIT_RECOVERIES = 3;
  const STABLE_ROUTE_RESET_MS = 30_000;
  let disposed = false;

  const getRouteState = (hotkeyId = "insert") =>
    hotkeyId === "clipboard" ? keyStates.clipboard : keyStates.insert;
  const getOutputMode = (hotkeyId = "insert") =>
    hotkeyId === "clipboard" ? "clipboard" : "insert";
  const clearRouteTimers = (state) => {
    if (state.holdTimer) clearTimeout(state.holdTimer);
    if (state.safetyTimer) clearTimeout(state.safetyTimer);
    state.holdTimer = null;
    state.safetyTimer = null;
  };
  const resetRouteState = (hotkeyId = "insert") => {
    const state = getRouteState(hotkeyId);
    clearRouteTimers(state);
    state.downTime = 0;
    state.isRecording = false;
    state.payload = null;
  };

  const forceStopRoute = (hotkeyId = "insert", reason = "listener-refresh") => {
    const routeState = getRouteState(hotkeyId);
    const wasActive = routeState.downTime > 0 || routeState.isRecording;
    const wasRecording = routeState.isRecording;
    const payload = routeState.payload
      ? {
          ...routeState.payload,
          releasedAt: Date.now(),
          forcedStopReason: reason,
        }
      : null;
    resetRouteState(hotkeyId);

    if (wasRecording && payload) {
      debugLogger.warn("[Push-to-Talk] Force-stopping active route", {
        hotkeyId,
        sessionId: payload.sessionId,
        reason,
      });
      windowManager.sendStopDictation(payload);
    } else if (wasActive) {
      windowManager.hideDictationPanel();
    }
    return wasActive;
  };

  const forceStopActiveRoutes = (reason = "listener-refresh") => {
    forceStopRoute("insert", reason);
    forceStopRoute("clipboard", reason);
  };

  const refreshWindowsKeyListeners = (modeOrOptions = null) => {
    if (disposed) return;
    if (!isLiveWindow(windowManager.mainWindow)) return;

    const options =
      modeOrOptions && typeof modeOrOptions === "object"
        ? modeOrOptions
        : { modeOverride: modeOrOptions, reason: "listener-refresh" };
    const modeOverride = options.modeOverride || null;
    const refreshReason = options.reason || "listener-refresh";
    const activationMode = modeOverride || windowManager.getActivationMode();
    const insertHotkey = hotkeyManager.getCurrentHotkey();
    const clipboardHotkey = windowManager.getCurrentClipboardHotkey
      ? windowManager.getCurrentClipboardHotkey()
      : null;
    const startedHotkeys = new Set();

    forceStopActiveRoutes(refreshReason);
    windowsKeyManager.stop();
    windowManager.clearWindowsNativeListenerReadiness?.();

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

  const onKeyDown = (key, hotkeyId = "insert") => {
    if (disposed) return;
    debugLogger.debug("[Push-to-Talk] Key DOWN received", { key, hotkeyId });
    if (!isLiveWindow(windowManager.mainWindow)) return;

    const activationMode = windowManager.getActivationMode();
    const routeState = getRouteState(hotkeyId);
    const outputMode = getOutputMode(hotkeyId);
    debugLogger.debug("[Push-to-Talk] Activation mode check", {
      activationMode,
      hotkeyId,
      outputMode,
    });

    if (activationMode === "push") {
      if (routeState.downTime > 0 || routeState.isRecording) {
        debugLogger.debug("[Push-to-Talk] Ignoring repeated key-down", { hotkeyId, outputMode });
        return;
      }
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

      routeState.holdTimer = setTimeout(() => {
        routeState.holdTimer = null;
        if (!disposed && routeState.downTime > 0 && !routeState.isRecording) {
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
          routeState.safetyTimer = setTimeout(() => {
            routeState.safetyTimer = null;
            forceStopRoute(hotkeyId, "safety-timeout");
          }, MAX_PUSH_DURATION_MS);
        }
      }, MIN_HOLD_DURATION_MS);
    } else if (activationMode === "tap") {
      windowManager.showDictationPanel();
      windowManager.sendToggleDictation(windowManager.createSessionPayload(outputMode));
    }
  };

  const onKeyUp = (key, hotkeyId = "insert") => {
    if (disposed) return;
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
  };

  const onError = (error) => {
    if (disposed) return;
    debugLogger.warn("[Push-to-Talk] Windows key listener error", { error: error.message });
    forceStopActiveRoutes("listener-error");
    windowManager.clearWindowsNativeListenerReadiness?.();
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
  };

  const onUnavailable = () => {
    if (disposed) return;
    debugLogger.debug(
      "[Push-to-Talk] Windows key listener not available - falling back to toggle mode"
    );
    forceStopActiveRoutes("listener-unavailable");
    windowManager.clearWindowsNativeListenerReadiness?.();
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
  };

  const onReady = (info) => {
    if (disposed) return;
    debugLogger.debug("[Push-to-Talk] WindowsKeyManager route ready", info);
    const hotkeyId = info?.hotkeyId === "clipboard" ? "clipboard" : "insert";
    const timer = unexpectedExitTimers.get(hotkeyId);
    if (timer) clearTimeout(timer);
    unexpectedExitTimers.delete(hotkeyId);
    const stableTimer = stableRouteTimers.get(hotkeyId);
    if (stableTimer) clearTimeout(stableTimer);
    stableRouteTimers.set(
      hotkeyId,
      setTimeout(() => {
        stableRouteTimers.delete(hotkeyId);
        unexpectedExitAttempts.delete(hotkeyId);
      }, STABLE_ROUTE_RESET_MS)
    );
    windowManager.setWindowsNativeListenerReady?.(info?.hotkeyId, true);
  };

  const onRouteStopped = (info) => {
    if (disposed) return;
    windowManager.setWindowsNativeListenerReady?.(info?.hotkeyId, false);
    const hotkeyId = info?.hotkeyId === "clipboard" ? "clipboard" : "insert";
    forceStopRoute(hotkeyId, `listener-${info?.reason || "stopped"}`);
    const stableTimer = stableRouteTimers.get(hotkeyId);
    if (stableTimer) clearTimeout(stableTimer);
    stableRouteTimers.delete(hotkeyId);
    if (info?.reason === "exit") {
      const attempt = (unexpectedExitAttempts.get(hotkeyId) || 0) + 1;
      unexpectedExitAttempts.set(hotkeyId, attempt);
      if (attempt > MAX_UNEXPECTED_EXIT_RECOVERIES) {
        debugLogger.warn("[Push-to-Talk] Windows key listener recovery limit reached", {
          ...info,
          attempt,
        });
        return;
      }

      const delayMs = 250 * 2 ** (attempt - 1);
      debugLogger.warn("[Push-to-Talk] Windows key listener exited; scheduling recovery", {
        ...info,
        attempt,
        delayMs,
      });
      const existingTimer = unexpectedExitTimers.get(hotkeyId);
      if (existingTimer) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        unexpectedExitTimers.delete(hotkeyId);
        try {
          refreshWindowsKeyListeners({ reason: "listener-exit-recovery" });
        } catch (error) {
          debugLogger.warn("[Push-to-Talk] Failed to recover exited key listener", {
            error: error?.message || String(error),
          });
        }
      }, delayMs);
      unexpectedExitTimers.set(hotkeyId, timer);
    }
  };

  windowsKeyManager.on("key-down", onKeyDown);
  windowsKeyManager.on("key-up", onKeyUp);
  windowsKeyManager.on("error", onError);
  windowsKeyManager.on("unavailable", onUnavailable);
  windowsKeyManager.on("ready", onReady);
  windowsKeyManager.on("route-stopped", onRouteStopped);

  const STARTUP_DELAY_MS = 1250;
  debugLogger.debug("[Push-to-Talk] Scheduling listener startup refresh", {
    delayMs: STARTUP_DELAY_MS,
  });
  const startupTimer = setTimeout(() => {
    if (disposed) return;
    try {
      refreshWindowsKeyListeners({ reason: "startup" });
    } catch (error) {
      debugLogger.warn("[Push-to-Talk] Failed to refresh listeners on startup", {
        error: error?.message || String(error),
      });
    }
  }, STARTUP_DELAY_MS);

  // Listen for activation mode changes from renderer
  const isTrustedControlPanelEvent = (event) => {
    try {
      requireTrustedRenderer(event, windowManager, ["control-panel"]);
      return true;
    } catch {
      return false;
    }
  };

  const onActivationModeChanged = (event, mode) => {
    if (disposed) return;
    if (!isTrustedControlPanelEvent(event) || (mode !== "tap" && mode !== "push")) return;
    debugLogger.debug("[Push-to-Talk] IPC: Activation mode changed", { mode });
    refreshWindowsKeyListeners({ modeOverride: mode, reason: "activation-mode-changed" });
  };

  // Listen for hotkey changes from renderer
  const onHotkeyChanged = (event, hotkey) => {
    if (disposed) return;
    if (!isTrustedControlPanelEvent(event) || typeof hotkey !== "string") return;
    debugLogger.debug("[Push-to-Talk] IPC: Hotkey changed", { hotkey });
    forceStopRoute("insert", "insert-hotkey-changed");
    refreshWindowsKeyListeners({ reason: "insert-hotkey-changed" });
  };

  const onClipboardHotkeyChanged = (event, hotkey) => {
    if (disposed) return;
    if (!isTrustedControlPanelEvent(event) || typeof hotkey !== "string") return;
    debugLogger.debug("[Push-to-Talk] IPC: Clipboard hotkey changed", { hotkey });
    forceStopRoute("clipboard", "clipboard-hotkey-changed");
    refreshWindowsKeyListeners({ reason: "clipboard-hotkey-changed" });
  };

  ipcMain.on("activation-mode-changed", onActivationModeChanged);
  ipcMain.on("hotkey-changed", onHotkeyChanged);
  ipcMain.on("clipboard-hotkey-changed", onClipboardHotkeyChanged);

  return {
    refreshWindowsKeyListeners,
    resetRouteState,
    forceStopActiveRoutes,
    forceStopRoute,
    dispose() {
      if (disposed) return;
      forceStopActiveRoutes("controller-disposed");
      disposed = true;
      clearTimeout(startupTimer);
      for (const timer of unexpectedExitTimers.values()) clearTimeout(timer);
      for (const timer of stableRouteTimers.values()) clearTimeout(timer);
      unexpectedExitTimers.clear();
      stableRouteTimers.clear();
      unexpectedExitAttempts.clear();
      ipcMain.removeListener("activation-mode-changed", onActivationModeChanged);
      ipcMain.removeListener("hotkey-changed", onHotkeyChanged);
      ipcMain.removeListener("clipboard-hotkey-changed", onClipboardHotkeyChanged);
      windowsKeyManager.removeListener("key-down", onKeyDown);
      windowsKeyManager.removeListener("key-up", onKeyUp);
      windowsKeyManager.removeListener("error", onError);
      windowsKeyManager.removeListener("unavailable", onUnavailable);
      windowsKeyManager.removeListener("ready", onReady);
      windowsKeyManager.removeListener("route-stopped", onRouteStopped);
      windowsKeyManager.stop();
      windowManager.clearWindowsNativeListenerReadiness?.();
    },
  };
}

module.exports = {
  registerWindowsPushToTalk,
};
