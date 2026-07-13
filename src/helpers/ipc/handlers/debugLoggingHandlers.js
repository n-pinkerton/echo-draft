function registerDebugLoggingHandlers(
  { ipcMain, app, path, shell, dialog, BrowserWindow, debugLogger, saveDebugAudioCapture },
  { environmentManager, windowManager }
) {
  let purgeRequestInProgress = false;

  const getTrustedControlPanelWindow = (event) => {
    const senderWindow = BrowserWindow?.fromWebContents?.(event?.sender) || null;
    const sentFromSubframe =
      event?.senderFrame &&
      event?.sender?.mainFrame &&
      event.senderFrame !== event.sender.mainFrame;
    const expectedWindow = windowManager?.controlPanelWindow || null;
    if (
      !senderWindow ||
      senderWindow.isDestroyed?.() ||
      sentFromSubframe ||
      senderWindow.webContents !== event?.sender ||
      !expectedWindow ||
      expectedWindow.isDestroyed?.() ||
      senderWindow !== expectedWindow
    ) {
      return null;
    }
    return senderWindow;
  };

  const applyDebugLoggingState = (enabled) => {
    const nextLevel = enabled ? "debug" : "info";
    const debugSaveResult = environmentManager.saveDebugLogLevel(nextLevel);
    const envWriteResult = debugSaveResult?.saveAllKeysResult || { success: true };
    if (envWriteResult?.success === false) {
      debugLogger.error("Failed to persist debug log level", {
        nextLevel,
        error: envWriteResult.error,
      });
      return {
        success: false,
        error: envWriteResult.error || "Failed to persist debug settings",
        envWriteResult,
      };
    }
    process.env.OPENWHISPR_LOG_LEVEL = nextLevel;
    debugLogger.refreshLogLevel();
    debugLogger.ensureFileLogging?.();

    return {
      success: true,
      envWriteResult,
      envWriteQueued: Boolean(envWriteResult?.queued),
      enabled: debugLogger.isEnabled(),
      logPath: debugLogger.getLogPath(),
      logsDir: debugLogger.getArtifactLogsDir?.() || debugLogger.getLogsDir?.() || null,
      logsDirSource: debugLogger.getLogsDirSource?.() || null,
      fileLoggingEnabled: debugLogger.isFileLoggingEnabled?.() || false,
      fileLoggingError: debugLogger.getFileLoggingError?.() || null,
      logLevel: debugLogger.getLevel(),
    };
  };

  ipcMain.handle("get-debug-state", async () => {
    try {
      const logsDir = debugLogger.getArtifactLogsDir?.() || debugLogger.getLogsDir?.() || null;
      return {
        enabled: debugLogger.isEnabled(),
        logPath: debugLogger.getLogPath(),
        logsDir,
        logsDirSource: debugLogger.getLogsDirSource?.() || null,
        fileLoggingEnabled: debugLogger.isFileLoggingEnabled?.() || false,
        fileLoggingError: debugLogger.getFileLoggingError?.() || null,
        logLevel: debugLogger.getLevel(),
      };
    } catch (error) {
      debugLogger.error("Failed to get debug state:", error);
      return { enabled: false, logPath: null, logsDir: null, logLevel: "info" };
    }
  });

  ipcMain.handle("set-debug-logging", async (event, enabled) => {
    try {
      const senderWindow = getTrustedControlPanelWindow(event);
      if (!senderWindow) {
        return { success: false, error: "Debug settings require the EchoDraft control panel" };
      }
      if (typeof enabled !== "boolean") {
        return { success: false, error: "Debug logging state must be true or false" };
      }

      if (enabled && !debugLogger.isEnabled()) {
        const confirmation = await dialog.showMessageBox(senderWindow, {
          type: "warning",
          title: "Enable sensitive diagnostics?",
          message: "Enable EchoDraft debug mode?",
          detail:
            "Debug mode writes detailed logs that may include dictated text and keeps up to 10 recent input recordings containing your voice on this computer. Turn it off and delete the data when troubleshooting is finished.",
          buttons: ["Cancel", "Enable Debug Mode"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (confirmation.response !== 1) {
          return { success: false, cancelled: true, enabled: false };
        }
      }

      return applyDebugLoggingState(enabled);
    } catch (error) {
      debugLogger.error("Failed to set debug logging:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("open-logs-folder", async () => {
    try {
      const logsDir =
        debugLogger.getArtifactLogsDir?.() ||
        debugLogger.getLogsDir?.() ||
        path.join(app.getPath("userData"), "logs");
      const openError = await shell.openPath(logsDir);
      if (openError) {
        return { success: false, error: openError };
      }
      return { success: true };
    } catch (error) {
      debugLogger.error("Failed to open logs folder:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("purge-debug-artifacts", async (event) => {
    if (purgeRequestInProgress) {
      return { success: false, busy: true, error: "Diagnostic cleanup is already in progress" };
    }

    const senderWindow = getTrustedControlPanelWindow(event);
    if (!senderWindow) {
      return { success: false, error: "Diagnostic cleanup requires the EchoDraft control panel" };
    }

    purgeRequestInProgress = true;
    try {
      if (typeof debugLogger.purgeArtifacts !== "function") {
        return { success: false, error: "Debug artifact cleanup is unavailable" };
      }

      const debugWasEnabled = Boolean(debugLogger.isEnabled?.());
      const buttons = debugWasEnabled
        ? ["Cancel", "Turn Off and Delete", "Delete; Keep Logging"]
        : ["Cancel", "Delete Data"];
      const confirmation = await dialog.showMessageBox(senderWindow, {
        type: "warning",
        title: "Delete diagnostic data?",
        message: "Permanently delete EchoDraft diagnostic data?",
        detail: debugWasEnabled
          ? "Debug mode is currently on. Choose whether to turn it off before deleting, or keep it on and start a fresh log immediately after cleanup. EchoDraft daily logs and captured debug recordings are deleted; other files are left untouched."
          : "This deletes EchoDraft daily logs and captured debug recordings from verified logs folders. Other files are left untouched.",
        buttons,
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (confirmation.response === 0) {
        return { success: false, cancelled: true };
      }

      if (debugWasEnabled && confirmation.response === 1) {
        const disableResult = applyDebugLoggingState(false);
        if (!disableResult.success) {
          return {
            ...disableResult,
            error: disableResult.error || "Could not turn off debug mode before cleanup",
          };
        }
      }

      const result = await debugLogger.purgeArtifacts();
      return {
        ...result,
        debugEnabled: Boolean(debugLogger.isEnabled?.()),
        error: result.success ? undefined : result.errors?.join("; ") || "Cleanup was incomplete",
      };
    } catch (error) {
      debugLogger.error("Failed to purge debug artifacts:", error);
      return { success: false, error: error?.message || String(error) };
    } finally {
      purgeRequestInProgress = false;
    }
  });

  ipcMain.handle("debug-save-audio", async (_event, payload = {}) => {
    if (debugLogger.isArtifactPurgeInProgress?.()) {
      return { success: false, skipped: true, reason: "purge-in-progress" };
    }
    if (!debugLogger.isEnabled?.() || !debugLogger.isEnabled()) {
      return { success: false, skipped: true, reason: "debug-disabled" };
    }

    try {
      const logsDir =
        debugLogger.getArtifactLogsDir?.() ||
        debugLogger.getLogsDir?.() ||
        path.join(app.getPath("userData"), "logs");
      const audioBuffer = payload?.audioBuffer;

      if (!audioBuffer) {
        return { success: false, error: "Missing audioBuffer" };
      }

      const result = saveDebugAudioCapture({
        logsDir,
        audioBuffer,
        mimeType: payload?.mimeType,
        sessionId: payload?.sessionId,
        jobId: payload?.jobId,
        outputMode: payload?.outputMode,
        durationSeconds: payload?.durationSeconds,
        stopReason: payload?.stopReason,
        stopSource: payload?.stopSource,
        maxCaptures: 10,
      });

      debugLogger.debug("Debug audio capture saved", result, "audio");

      return { success: true, ...result };
    } catch (error) {
      debugLogger.error("Debug audio capture save failed:", error);
      return { success: false, error: error?.message || String(error) };
    }
  });
}

module.exports = { registerDebugLoggingHandlers };
