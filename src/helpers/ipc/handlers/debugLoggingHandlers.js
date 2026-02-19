function registerDebugLoggingHandlers(
  { ipcMain, app, path, shell, debugLogger, saveDebugAudioCapture },
  { environmentManager }
) {
  ipcMain.handle("get-debug-state", async () => {
    try {
      const logsDir = debugLogger.getLogsDir?.() || null;
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

  ipcMain.handle("set-debug-logging", async (_event, enabled) => {
    try {
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
        logsDir: debugLogger.getLogsDir?.() || null,
        logsDirSource: debugLogger.getLogsDirSource?.() || null,
        fileLoggingEnabled: debugLogger.isFileLoggingEnabled?.() || false,
        fileLoggingError: debugLogger.getFileLoggingError?.() || null,
        logLevel: debugLogger.getLevel(),
      };
    } catch (error) {
      debugLogger.error("Failed to set debug logging:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("open-logs-folder", async () => {
    try {
      const logsDir = debugLogger.getLogsDir?.() || path.join(app.getPath("userData"), "logs");
      await shell.openPath(logsDir);
      return { success: true };
    } catch (error) {
      debugLogger.error("Failed to open logs folder:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("debug-save-audio", async (_event, payload = {}) => {
    if (!debugLogger.isEnabled?.() || !debugLogger.isEnabled()) {
      return { success: false, skipped: true, reason: "debug-disabled" };
    }

    try {
      const logsDir = debugLogger.getLogsDir?.() || path.join(app.getPath("userData"), "logs");
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

