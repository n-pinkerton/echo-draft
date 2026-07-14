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
      suppressed: false,
    },
    clipboard: {
      downTime: 0,
      isRecording: false,
      payload: null,
      holdTimer: null,
      safetyTimer: null,
      suppressed: false,
    },
  };
  const unexpectedExitAttempts = new Map();
  const unexpectedExitTimers = new Map();
  const stableRouteTimers = new Map();
  const fallbackRestoreTimers = new Map();
  const fallbackRestoreAttempts = new Map();
  const nativeRegisteredTapRoutes = new Set();
  const globalFallbackActiveRoutes = new Set();
  const unavailableRoutes = new Map();
  const MAX_UNEXPECTED_EXIT_RECOVERIES = 3;
  const STABLE_ROUTE_RESET_MS = 30_000;
  const FALLBACK_RESTORE_RETRY_DELAYS_MS = [100, 250, 500];
  const TERMINATION_RETRY_DELAY_MS = 250;
  const MAX_TERMINATION_RETRIES = 3;
  let disposed = false;
  let refreshInProgress = false;
  let refreshChain = Promise.resolve();
  let terminationBlocked = false;
  let terminationRetryTimer = null;
  let terminationRetryAttempts = 0;
  let activePushRouteId = null;

  const isHotkeyCaptureActive = () => hotkeyManager.isInListeningMode?.() === true;

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
    state.suppressed = false;
    if (activePushRouteId === hotkeyId) activePushRouteId = null;
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
    return {
      insert: forceStopRoute("insert", reason),
      clipboard: forceStopRoute("clipboard", reason),
    };
  };

  const getRouteHotkey = (hotkeyId) =>
    hotkeyId === "clipboard"
      ? windowManager.getCurrentClipboardHotkey?.()
      : hotkeyManager.getCurrentHotkey();

  const getConfiguredNativeRouteIds = () => {
    const activationMode = windowManager.getActivationMode();
    return ["insert", "clipboard"].filter((hotkeyId) => {
      const hotkey = getRouteHotkey(hotkeyId);
      return Boolean(
        hotkey && windowManager.shouldUseWindowsNativeListener(hotkey, activationMode)
      );
    });
  };

  const publishWindowsPttStatus = (channel, payload) => {
    for (const window of [windowManager.mainWindow, windowManager.controlPanelWindow]) {
      if (isLiveWindow(window) && typeof window.webContents?.send === "function") {
        window.webContents.send(channel, payload);
      }
    }
  };

  const getUnavailableRouteStates = () =>
    [...unavailableRoutes.values()].map((state) => ({ ...state }));

  const markRouteUnavailable = (
    hotkeyId,
    reason,
    { recordingSafetyStopped = false, recoveryPending = false } = {}
  ) => {
    const normalizedRoute = hotkeyId === "clipboard" ? "clipboard" : "insert";
    const previous = unavailableRoutes.get(normalizedRoute);
    const state = {
      routeId: normalizedRoute,
      reason,
      fallbackActive: globalFallbackActiveRoutes.has(normalizedRoute),
      recoveryPending: recoveryPending === true,
      recordingSafetyStopped:
        recordingSafetyStopped === true || previous?.recordingSafetyStopped === true,
    };
    unavailableRoutes.set(normalizedRoute, state);
    publishWindowsPttStatus("windows-ptt-unavailable", {
      ...state,
      unavailableRoutes: getUnavailableRouteStates(),
    });
  };

  const markRouteRecovered = (hotkeyId) => {
    const normalizedRoute = hotkeyId === "clipboard" ? "clipboard" : "insert";
    if (!unavailableRoutes.delete(normalizedRoute)) return;
    publishWindowsPttStatus("windows-ptt-recovered", {
      routeId: normalizedRoute,
      remainingUnavailableRoutes: [...unavailableRoutes.keys()],
      remainingUnavailableRouteStates: getUnavailableRouteStates(),
    });
  };

  const cancelFallbackRestore = (hotkeyId) => {
    const timer = fallbackRestoreTimers.get(hotkeyId);
    if (timer) clearTimeout(timer);
    fallbackRestoreTimers.delete(hotkeyId);
    fallbackRestoreAttempts.delete(hotkeyId);
  };

  const restoreGlobalFallback = (hotkeyId, attempt = 0) => {
    const pendingTimer = fallbackRestoreTimers.get(hotkeyId);
    if (pendingTimer) clearTimeout(pendingTimer);
    fallbackRestoreTimers.delete(hotkeyId);
    if (disposed || isHotkeyCaptureActive()) return null;

    const result = windowManager.restoreGlobalHotkeyFallback?.(hotkeyId);
    if (!result || result.success !== false) {
      globalFallbackActiveRoutes.add(hotkeyId);
      fallbackRestoreAttempts.delete(hotkeyId);
      return result;
    }

    globalFallbackActiveRoutes.delete(hotkeyId);

    debugLogger.warn("[Push-to-Talk] Global hotkey fallback registration failed", {
      hotkeyId,
      attempt: attempt + 1,
      message: result.message || result.error || "unknown error",
    });

    // Clipboard registration already owns a bounded retry timer. The insert route uses the
    // retries below because a crashed native helper can briefly retain RegisterHotKey while
    // Windows finishes terminating the process.
    if (hotkeyId === "clipboard") return result;

    if (attempt < FALLBACK_RESTORE_RETRY_DELAYS_MS.length) {
      const delayMs = FALLBACK_RESTORE_RETRY_DELAYS_MS[attempt];
      fallbackRestoreAttempts.set(hotkeyId, attempt + 1);
      const timer = setTimeout(() => {
        fallbackRestoreTimers.delete(hotkeyId);
        restoreGlobalFallback(hotkeyId, attempt + 1);
      }, delayMs);
      timer.unref?.();
      fallbackRestoreTimers.set(hotkeyId, timer);
      return result;
    }

    fallbackRestoreAttempts.delete(hotkeyId);
    windowManager.onInsertHotkeyRegistrationFailure?.(result);
    return result;
  };

  const restoreAllRegisteredTapFallbacks = () => {
    for (const routeId of nativeRegisteredTapRoutes) {
      restoreGlobalFallback(routeId);
    }
    nativeRegisteredTapRoutes.clear();
  };

  const suspendFallbackTrackingForCapture = () => {
    for (const timer of fallbackRestoreTimers.values()) clearTimeout(timer);
    fallbackRestoreTimers.clear();
    fallbackRestoreAttempts.clear();
    nativeRegisteredTapRoutes.clear();
    globalFallbackActiveRoutes.clear();
  };

  const cancelTerminationRetry = () => {
    if (terminationRetryTimer) clearTimeout(terminationRetryTimer);
    terminationRetryTimer = null;
  };

  const scheduleTerminationRetry = (reason) => {
    if (terminationRetryTimer) return true;
    if (
      disposed ||
      isHotkeyCaptureActive() ||
      terminationRetryAttempts >= MAX_TERMINATION_RETRIES
    ) {
      return false;
    }
    terminationRetryAttempts += 1;
    terminationRetryTimer = setTimeout(() => {
      terminationRetryTimer = null;
      if (disposed || isHotkeyCaptureActive()) return;
      void refreshWindowsKeyListeners({ reason: `${reason}-termination-retry` }).catch(() => {});
    }, TERMINATION_RETRY_DELAY_MS);
    terminationRetryTimer.unref?.();
    return true;
  };

  const performRefreshWindowsKeyListeners = async (modeOrOptions = null) => {
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
    const routeSpecs = [
      { hotkey: insertHotkey, routeId: "insert" },
      { hotkey: clipboardHotkey, routeId: "clipboard" },
    ];
    const desiredRegisteredTapRoutes = new Set(
      routeSpecs
        .filter(
          ({ hotkey }) =>
            activationMode === "tap" &&
            windowManager.shouldUseWindowsNativeListener(hotkey, activationMode) &&
            windowManager.canUseWindowsRegisteredTapHotkey?.(hotkey)
        )
        .map(({ routeId }) => routeId)
    );
    const startedHotkeys = new Set();

    forceStopActiveRoutes(refreshReason);
    refreshInProgress = true;
    try {
      const stopped =
        typeof windowsKeyManager.stopAndWait === "function"
          ? await windowsKeyManager.stopAndWait()
          : (windowsKeyManager.stop(), true);
      if (!stopped) {
        debugLogger.warn("[Push-to-Talk] Timed out waiting for previous key listeners to exit", {
          reason: refreshReason,
        });
      }
      windowManager.clearWindowsNativeListenerReadiness?.();
      if (disposed) return;

      if (!stopped) {
        terminationBlocked = true;
        if (isHotkeyCaptureActive()) {
          suspendFallbackTrackingForCapture();
          return;
        }

        // Never overlap helpers. The old process may still own RegisterHotKey, so restore the
        // Electron fallback where Windows permits it and retry only after another exit check.
        restoreAllRegisteredTapFallbacks();
        const stoppedRoutes = forceStopActiveRoutes("listener-shutdown-pending");
        const recoveryPending = scheduleTerminationRetry(refreshReason);
        for (const routeId of getConfiguredNativeRouteIds()) {
          markRouteUnavailable(routeId, "listener_shutdown_pending", {
            recordingSafetyStopped: stoppedRoutes[routeId] === true,
            recoveryPending,
          });
        }
        return;
      }

      terminationBlocked = false;
      terminationRetryAttempts = 0;
      cancelTerminationRetry();
      if (isHotkeyCaptureActive()) {
        // Capture deliberately owns the keyboard while the input is focused. Do not restore a
        // global fallback here: the capture IPC path will recover configured routes on blur.
        suspendFallbackTrackingForCapture();
        return;
      }

      for (const routeId of nativeRegisteredTapRoutes) {
        if (!desiredRegisteredTapRoutes.has(routeId)) {
          restoreGlobalFallback(routeId);
        }
      }
      nativeRegisteredTapRoutes.clear();

      const maybeStartRoute = (hotkey, routeId) => {
        if (disposed || isHotkeyCaptureActive()) return;
        if (!hotkey || hotkey === "GLOBE" || startedHotkeys.has(hotkey)) {
          return;
        }
        if (!windowManager.shouldUseWindowsNativeListener(hotkey, activationMode)) {
          return;
        }
        const useRegisteredTap = desiredRegisteredTapRoutes.has(routeId);
        if (useRegisteredTap) {
          cancelFallbackRestore(routeId);
          globalFallbackActiveRoutes.delete(routeId);
          windowManager.suspendGlobalHotkeyForNativeTap?.(routeId);
          nativeRegisteredTapRoutes.add(routeId);
        } else if (windowManager.canUseWindowsRegisteredTapHotkey?.(hotkey)) {
          // Push-to-talk keeps Electron's ordinary accelerator registered as a safe tap-to-toggle
          // fallback if the native key-up listener later becomes unavailable.
          globalFallbackActiveRoutes.add(routeId);
        }
        const listenerMode = useRegisteredTap ? "tap" : "hook";
        debugLogger.debug("[Push-to-Talk] Starting Windows key listener route", {
          routeId,
          hotkey,
          activationMode,
          listenerMode,
        });
        const started = windowsKeyManager.start(hotkey, routeId, { mode: listenerMode });
        if (started === false) {
          const retirementPending = windowsKeyManager.hasRetiringProcess?.(routeId) === true;
          terminationBlocked = terminationBlocked || retirementPending;
          if (useRegisteredTap && nativeRegisteredTapRoutes.delete(routeId)) {
            restoreGlobalFallback(routeId);
          }
          const recoveryPending = retirementPending
            ? scheduleTerminationRetry(refreshReason)
            : false;
          markRouteUnavailable(routeId, "listener_start_failed", { recoveryPending });
          return;
        }
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
    } finally {
      refreshInProgress = false;
    }
  };

  const refreshWindowsKeyListeners = (modeOrOptions = null) => {
    const refresh = refreshChain.then(() => performRefreshWindowsKeyListeners(modeOrOptions));
    refreshChain = refresh.catch((error) => {
      debugLogger.warn("[Push-to-Talk] Key listener refresh failed", {
        error: error?.message || String(error),
      });
    });
    return refresh;
  };

  const scheduleRouteRecovery = (hotkeyId, info = {}) => {
    if (unexpectedExitTimers.has(hotkeyId)) return true;
    const attempt = (unexpectedExitAttempts.get(hotkeyId) || 0) + 1;
    unexpectedExitAttempts.set(hotkeyId, attempt);
    if (attempt > MAX_UNEXPECTED_EXIT_RECOVERIES) {
      debugLogger.warn("[Push-to-Talk] Windows key listener recovery limit reached", {
        ...info,
        hotkeyId,
        attempt,
      });
      return false;
    }

    const delayMs = 250 * 2 ** (attempt - 1);
    debugLogger.warn("[Push-to-Talk] Windows key listener exited; scheduling recovery", {
      ...info,
      hotkeyId,
      attempt,
      delayMs,
    });
    const timer = setTimeout(() => {
      unexpectedExitTimers.delete(hotkeyId);
      void refreshWindowsKeyListeners({ reason: "listener-exit-recovery" }).catch((error) => {
        debugLogger.warn("[Push-to-Talk] Failed to recover exited key listener", {
          error: error?.message || String(error),
        });
      });
    }, delayMs);
    unexpectedExitTimers.set(hotkeyId, timer);
    return true;
  };

  const onKeyDown = (key, hotkeyId = "insert") => {
    if (disposed || isHotkeyCaptureActive()) return;
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
      if (routeState.downTime > 0 || routeState.isRecording || routeState.suppressed) {
        debugLogger.debug("[Push-to-Talk] Ignoring repeated key-down", { hotkeyId, outputMode });
        return;
      }
      if (activePushRouteId && activePushRouteId !== hotkeyId) {
        // Only the route that reserved the current push can later stop it. Keep
        // the overlapping key suppressed until its matching key-up so a rejected
        // renderer start cannot truncate the accepted recording.
        routeState.suppressed = true;
        debugLogger.debug("[Push-to-Talk] Suppressing overlapping push route", {
          hotkeyId,
          activePushRouteId,
        });
        return;
      }
      activePushRouteId = hotkeyId;
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
    if (disposed || isHotkeyCaptureActive()) return;
    debugLogger.debug("[Push-to-Talk] Key UP received", { key, hotkeyId });
    if (!isLiveWindow(windowManager.mainWindow)) return;

    const activationMode = windowManager.getActivationMode();
    if (activationMode === "push") {
      const routeState = getRouteState(hotkeyId);
      const wasSuppressed = routeState.suppressed === true;
      const hadActivePress = routeState.downTime > 0 || routeState.isRecording || wasSuppressed;
      const wasRecording = routeState.isRecording;
      const payload = routeState.payload ? { ...routeState.payload, releasedAt: Date.now() } : null;
      resetRouteState(hotkeyId);
      if (!hadActivePress) return;
      if (wasSuppressed) {
        debugLogger.debug("[Push-to-Talk] Ignoring release from suppressed push route", {
          hotkeyId,
        });
        return;
      }
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

  const onError = (error, info = {}) => {
    if (disposed) return;
    debugLogger.warn("[Push-to-Talk] Windows key listener error", { error: error.message });
    const stoppedRoutes = forceStopActiveRoutes("listener-error");
    windowManager.clearWindowsNativeListenerReadiness?.();
    if (isHotkeyCaptureActive()) {
      suspendFallbackTrackingForCapture();
      return;
    }
    restoreAllRegisteredTapFallbacks();
    const routeIds = getConfiguredNativeRouteIds();
    for (const routeId of routeIds) {
      const recoveryPending = scheduleRouteRecovery(routeId, info);
      markRouteUnavailable(routeId, "listener_error", {
        recordingSafetyStopped: stoppedRoutes[routeId] === true,
        recoveryPending,
      });
    }
  };

  const onUnavailable = (_error, info = {}) => {
    if (disposed) return;
    debugLogger.debug(
      "[Push-to-Talk] Windows key listener not available - falling back to toggle mode"
    );
    const stoppedRoutes = forceStopActiveRoutes("listener-unavailable");
    windowManager.clearWindowsNativeListenerReadiness?.();
    if (isHotkeyCaptureActive()) {
      suspendFallbackTrackingForCapture();
      return;
    }
    restoreAllRegisteredTapFallbacks();
    const routeIds = info?.hotkeyId ? [info.hotkeyId] : getConfiguredNativeRouteIds();
    for (const routeId of routeIds) {
      markRouteUnavailable(routeId, "binary_not_found", {
        recordingSafetyStopped: stoppedRoutes[routeId] === true,
        recoveryPending: false,
      });
    }
  };

  const onReady = (info) => {
    if (disposed || isHotkeyCaptureActive()) return;
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
    markRouteRecovered(hotkeyId);
  };

  const onRouteStopped = (info) => {
    if (disposed) return;
    const hotkeyId = info?.hotkeyId === "clipboard" ? "clipboard" : "insert";
    windowManager.setWindowsNativeListenerReady?.(hotkeyId, false);
    const recordingSafetyStopped = forceStopRoute(
      hotkeyId,
      `listener-${info?.reason || "stopped"}`
    );
    const stableTimer = stableRouteTimers.get(hotkeyId);
    if (stableTimer) clearTimeout(stableTimer);
    stableRouteTimers.delete(hotkeyId);
    if (refreshInProgress && info?.reason === "stopped") {
      return;
    }
    if (isHotkeyCaptureActive()) {
      nativeRegisteredTapRoutes.delete(hotkeyId);
      globalFallbackActiveRoutes.delete(hotkeyId);
      return;
    }
    if (info?.mode === "tap" || nativeRegisteredTapRoutes.has(hotkeyId)) {
      nativeRegisteredTapRoutes.delete(hotkeyId);
      restoreGlobalFallback(hotkeyId);
    }
    if (info?.reason === "exit") {
      const recoveryPending = scheduleRouteRecovery(hotkeyId, info);
      markRouteUnavailable(hotkeyId, "listener_exited", {
        recordingSafetyStopped,
        recoveryPending,
      });
    }
  };

  const onRetirementConfirmed = () => {
    if (disposed || refreshInProgress || !terminationBlocked || isHotkeyCaptureActive()) return;
    cancelTerminationRetry();
    terminationRetryAttempts = 0;
    void refreshWindowsKeyListeners({ reason: "listener-termination-confirmed" }).catch(() => {});
  };

  windowsKeyManager.on("key-down", onKeyDown);
  windowsKeyManager.on("key-up", onKeyUp);
  windowsKeyManager.on("error", onError);
  windowsKeyManager.on("unavailable", onUnavailable);
  windowsKeyManager.on("ready", onReady);
  windowsKeyManager.on("route-stopped", onRouteStopped);
  windowsKeyManager.on("retirement-confirmed", onRetirementConfirmed);

  const STARTUP_DELAY_MS = 1250;
  debugLogger.debug("[Push-to-Talk] Scheduling listener startup refresh", {
    delayMs: STARTUP_DELAY_MS,
  });
  const startupTimer = setTimeout(() => {
    if (disposed) return;
    void refreshWindowsKeyListeners({ reason: "startup" }).catch((error) => {
      debugLogger.warn("[Push-to-Talk] Failed to refresh listeners on startup", {
        error: error?.message || String(error),
      });
    });
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
    void refreshWindowsKeyListeners({
      modeOverride: mode,
      reason: "activation-mode-changed",
    }).catch(() => {});
  };

  // Listen for hotkey changes from renderer
  const onHotkeyChanged = (event, hotkey) => {
    if (disposed) return;
    if (!isTrustedControlPanelEvent(event) || typeof hotkey !== "string") return;
    debugLogger.debug("[Push-to-Talk] IPC: Hotkey changed", { hotkey });
    forceStopRoute("insert", "insert-hotkey-changed");
    void refreshWindowsKeyListeners({ reason: "insert-hotkey-changed" }).catch(() => {});
  };

  const onClipboardHotkeyChanged = (event, hotkey) => {
    if (disposed) return;
    if (!isTrustedControlPanelEvent(event) || typeof hotkey !== "string") return;
    debugLogger.debug("[Push-to-Talk] IPC: Clipboard hotkey changed", { hotkey });
    forceStopRoute("clipboard", "clipboard-hotkey-changed");
    void refreshWindowsKeyListeners({ reason: "clipboard-hotkey-changed" }).catch(() => {});
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
      for (const timer of fallbackRestoreTimers.values()) clearTimeout(timer);
      cancelTerminationRetry();
      unexpectedExitTimers.clear();
      stableRouteTimers.clear();
      fallbackRestoreTimers.clear();
      unexpectedExitAttempts.clear();
      fallbackRestoreAttempts.clear();
      nativeRegisteredTapRoutes.clear();
      globalFallbackActiveRoutes.clear();
      unavailableRoutes.clear();
      ipcMain.removeListener("activation-mode-changed", onActivationModeChanged);
      ipcMain.removeListener("hotkey-changed", onHotkeyChanged);
      ipcMain.removeListener("clipboard-hotkey-changed", onClipboardHotkeyChanged);
      windowsKeyManager.removeListener("key-down", onKeyDown);
      windowsKeyManager.removeListener("key-up", onKeyUp);
      windowsKeyManager.removeListener("error", onError);
      windowsKeyManager.removeListener("unavailable", onUnavailable);
      windowsKeyManager.removeListener("ready", onReady);
      windowsKeyManager.removeListener("route-stopped", onRouteStopped);
      windowsKeyManager.removeListener("retirement-confirmed", onRetirementConfirmed);
      windowsKeyManager.stop();
      windowManager.clearWindowsNativeListenerReadiness?.();
    },
  };
}

module.exports = {
  registerWindowsPushToTalk,
};
