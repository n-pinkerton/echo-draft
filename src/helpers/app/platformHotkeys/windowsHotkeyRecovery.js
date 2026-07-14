function registerWindowsHotkeyRecovery({
  powerMonitor,
  windowManager,
  windowsHotkeyController,
  controlPanelShortcutRegistration,
  debugLogger,
  platform = process.platform,
  delayMs = 500,
  retryDelayMs = 500,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (platform !== "win32" || !powerMonitor || !windowManager) {
    return () => {};
  }

  const maxAttempts = 3;
  let debounceTimer = null;
  let retryTimer = null;
  let disposed = false;
  let recoveryInFlight = false;
  let pendingReason = null;
  let resolveRetryDelay = null;
  const isHotkeyCaptureActive = () => windowManager.hotkeyManager?.isInListeningMode?.() === true;

  const waitForRetry = () =>
    new Promise((resolve) => {
      resolveRetryDelay = resolve;
      retryTimer = setTimeoutFn(() => {
        retryTimer = null;
        resolveRetryDelay = null;
        resolve(!disposed);
      }, retryDelayMs);
    });

  const recover = async (reason) => {
    if (isHotkeyCaptureActive()) {
      debugLogger?.debug?.("[HotkeyRecovery] Skipped while hotkey capture is active", { reason });
      return;
    }
    recoveryInFlight = true;
    let registration = null;
    let attempt = 0;

    try {
      windowsHotkeyController?.forceStopActiveRoutes?.(`system-${reason}`);

      while (!disposed && attempt < maxAttempts) {
        if (isHotkeyCaptureActive()) return;
        attempt += 1;
        let threw = false;
        try {
          registration = await windowManager.recoverHotkeys?.();
        } catch {
          registration = null;
          threw = true;
        }
        if (disposed) return;
        if (isHotkeyCaptureActive()) return;

        const insertSuccess = registration?.insert?.success === true;
        debugLogger?.debug?.("[HotkeyRecovery] Insert registration attempt finished", {
          reason,
          attempt,
          maxAttempts,
          insertSuccess,
          threw,
          final: insertSuccess || attempt === maxAttempts,
        });

        if (insertSuccess) break;
        if (attempt < maxAttempts && !(await waitForRetry())) return;
      }

      if (registration?.insert?.success !== true) {
        windowManager.onInsertHotkeyRegistrationFailure?.(registration?.insert || {});
        debugLogger?.warn?.("[HotkeyRecovery] Insert registration failed after final attempt", {
          reason,
          attempts: attempt,
          final: true,
        });
      }

      if (isHotkeyCaptureActive()) return;
      const controlPanel = controlPanelShortcutRegistration?.refresh?.(`system-${reason}`) || null;
      await windowsHotkeyController?.refreshWindowsKeyListeners?.({
        reason: `system-${reason}`,
      });
      debugLogger?.debug?.("[HotkeyRecovery] Recovery finished", {
        reason,
        attempts: attempt,
        insertSuccess: registration?.insert?.success ?? false,
        clipboardSuccess: registration?.clipboard?.success ?? null,
        controlPanelSuccess: controlPanel?.registered ?? null,
        final: true,
      });
    } catch (error) {
      if (disposed) return;
      debugLogger?.warn?.("[HotkeyRecovery] Recovery stopped unexpectedly", {
        reason,
        errorType: error?.name || "Error",
        final: true,
      });
    } finally {
      recoveryInFlight = false;
      if (!disposed && pendingReason) {
        const nextReason = pendingReason;
        pendingReason = null;
        void recover(nextReason);
      }
    }
  };

  const scheduleRecovery = (reason) => {
    if (disposed || isHotkeyCaptureActive()) return;
    if (debounceTimer) clearTimeoutFn(debounceTimer);
    debounceTimer = setTimeoutFn(() => {
      debounceTimer = null;
      if (disposed || isHotkeyCaptureActive()) return;
      if (recoveryInFlight) {
        pendingReason = reason;
        return;
      }
      void recover(reason);
    }, delayMs);
  };

  const onResume = () => scheduleRecovery("resume");
  const onUnlock = () => scheduleRecovery("unlock-screen");
  powerMonitor.on("resume", onResume);
  powerMonitor.on("unlock-screen", onUnlock);

  return () => {
    disposed = true;
    pendingReason = null;
    if (debounceTimer) {
      clearTimeoutFn(debounceTimer);
      debounceTimer = null;
    }
    if (retryTimer) {
      clearTimeoutFn(retryTimer);
      retryTimer = null;
    }
    if (resolveRetryDelay) {
      const resolve = resolveRetryDelay;
      resolveRetryDelay = null;
      resolve(false);
    }
    powerMonitor.removeListener("resume", onResume);
    powerMonitor.removeListener("unlock-screen", onUnlock);
  };
}

module.exports = {
  registerWindowsHotkeyRecovery,
};
