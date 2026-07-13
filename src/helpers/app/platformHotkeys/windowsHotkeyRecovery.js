function registerWindowsHotkeyRecovery({
  powerMonitor,
  windowManager,
  windowsHotkeyController,
  debugLogger,
  platform = process.platform,
  delayMs = 500,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (platform !== "win32" || !powerMonitor || !windowManager) {
    return () => {};
  }

  let timer = null;

  const recover = async (reason) => {
    timer = null;
    try {
      windowsHotkeyController?.forceStopActiveRoutes?.(`system-${reason}`);
      const registration = await windowManager.recoverHotkeys?.();
      windowsHotkeyController?.refreshWindowsKeyListeners?.({ reason: `system-${reason}` });
      debugLogger?.debug?.("[HotkeyRecovery] Hotkeys refreshed", {
        reason,
        insertSuccess: registration?.insert?.success ?? null,
        clipboardSuccess: registration?.clipboard?.success ?? null,
      });
    } catch (error) {
      debugLogger?.warn?.("[HotkeyRecovery] Failed to refresh hotkeys", {
        reason,
        error: error?.message || String(error),
      });
    }
  };

  const scheduleRecovery = (reason) => {
    if (timer) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => void recover(reason), delayMs);
  };

  const onResume = () => scheduleRecovery("resume");
  const onUnlock = () => scheduleRecovery("unlock-screen");
  powerMonitor.on("resume", onResume);
  powerMonitor.on("unlock-screen", onUnlock);

  return () => {
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
    powerMonitor.removeListener("resume", onResume);
    powerMonitor.removeListener("unlock-screen", onUnlock);
  };
}

module.exports = {
  registerWindowsHotkeyRecovery,
};
