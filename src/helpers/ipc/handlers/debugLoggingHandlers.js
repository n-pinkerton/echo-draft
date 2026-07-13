const { requireTrustedRenderer } = require("../trustedRenderer");

const MAX_DEBUG_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_DEBUG_AUDIO_DURATION_SECONDS = 30 * 60;
const DEBUG_CAPTURE_ADMISSION_WINDOW_MS = 10 * 60 * 1000;
const MAX_DEBUG_CAPTURES_PER_WINDOW = 20;
const MAX_DEBUG_CAPTURE_BYTES_PER_WINDOW = 256 * 1024 * 1024;
const ALLOWED_DEBUG_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
]);

function createAsyncMutex() {
  let tail = Promise.resolve();
  return {
    async run(operation) {
      let release;
      const previous = tail;
      tail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
}

function registerDebugLoggingHandlers(
  { ipcMain, app, path, shell, dialog, BrowserWindow, debugLogger, saveDebugAudioCapture },
  { environmentManager, windowManager }
) {
  let purgeRequestInProgress = false;
  const artifactMutex = createAsyncMutex();
  let debugCaptureAdmissions = [];

  const admitDebugCapture = (bytes, now = Date.now()) => {
    debugCaptureAdmissions = debugCaptureAdmissions.filter(
      (entry) => now - entry.at < DEBUG_CAPTURE_ADMISSION_WINDOW_MS
    );
    const admittedBytes = debugCaptureAdmissions.reduce((sum, entry) => sum + entry.bytes, 0);
    if (
      debugCaptureAdmissions.length >= MAX_DEBUG_CAPTURES_PER_WINDOW ||
      admittedBytes + bytes > MAX_DEBUG_CAPTURE_BYTES_PER_WINDOW
    ) {
      return false;
    }
    debugCaptureAdmissions.push({ at: now, bytes });
    return true;
  };

  const getTrustedControlPanelWindow = (event) => {
    try {
      requireTrustedRenderer(event, windowManager, ["control-panel"]);
    } catch {
      return null;
    }
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
    if (enabled) {
      environmentManager.setDebugConsent(true);
    }
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
    if (!enabled) {
      environmentManager.setDebugConsent(false);
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

  ipcMain.handle("get-debug-state", async (event) => {
    try {
      const role = requireTrustedRenderer(event, windowManager);
      if (role === "dictation") {
        return {
          enabled: debugLogger.isEnabled(),
          logPath: null,
          logsDir: null,
          logsDirSource: null,
          fileLoggingEnabled: debugLogger.isFileLoggingEnabled?.() || false,
          fileLoggingError: null,
          logLevel: debugLogger.getLevel(),
        };
      }
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

  ipcMain.handle("open-logs-folder", async (event) => {
    try {
      requireTrustedRenderer(event, windowManager, ["control-panel"]);
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
      return await artifactMutex.run(async () => {
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
      });
    } catch (error) {
      debugLogger.error("Failed to purge debug artifacts:", error);
      return { success: false, error: error?.message || String(error) };
    } finally {
      purgeRequestInProgress = false;
    }
  });

  ipcMain.handle("debug-save-audio", async (event, payload = {}) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    if (debugLogger.isArtifactPurgeInProgress?.()) {
      return { success: false, skipped: true, reason: "purge-in-progress" };
    }
    if (!debugLogger.isEnabled?.() || !debugLogger.isEnabled()) {
      return { success: false, skipped: true, reason: "debug-disabled" };
    }

    try {
      const audioBuffer = payload?.audioBuffer;
      const byteLength =
        audioBuffer instanceof ArrayBuffer
          ? audioBuffer.byteLength
          : ArrayBuffer.isView(audioBuffer)
            ? audioBuffer.byteLength
            : -1;
      if (byteLength < 1 || byteLength > MAX_DEBUG_AUDIO_BYTES) {
        return { success: false, error: "Debug audio is missing or exceeds the size limit" };
      }
      const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : "";
      const outputMode = ["insert", "clipboard", "file"].includes(payload?.outputMode)
        ? payload.outputMode
        : null;
      if (
        !sessionId ||
        !outputMode ||
        !windowManager?.isIssuedDictationSession?.(sessionId, outputMode)
      ) {
        return { success: false, error: "Debug audio session is invalid or expired" };
      }
      const mimeType = String(payload?.mimeType || "audio/webm")
        .split(";")[0]
        .toLowerCase();
      if (!ALLOWED_DEBUG_AUDIO_MIME_TYPES.has(mimeType)) {
        return { success: false, error: "Debug audio type is not supported" };
      }
      const durationSeconds = Number(payload?.durationSeconds);
      if (
        payload?.durationSeconds != null &&
        (!Number.isFinite(durationSeconds) ||
          durationSeconds < 0 ||
          durationSeconds > MAX_DEBUG_AUDIO_DURATION_SECONDS)
      ) {
        return { success: false, error: "Debug audio duration is invalid" };
      }

      return await artifactMutex.run(async () => {
        if (!debugLogger.isEnabled?.() || !debugLogger.isEnabled()) {
          return { success: false, skipped: true, reason: "debug-disabled" };
        }
        if (!windowManager?.isIssuedDictationSession?.(sessionId, outputMode)) {
          return { success: false, error: "Debug audio session is invalid or expired" };
        }
        if (!windowManager?.claimDebugAudioSession?.(sessionId, outputMode)) {
          return { success: false, error: "Debug audio session was already used" };
        }
        if (!admitDebugCapture(byteLength)) {
          return { success: false, skipped: true, reason: "capture-rate-limited" };
        }

        const logsDir =
          debugLogger.getArtifactLogsDir?.() ||
          debugLogger.getLogsDir?.() ||
          path.join(app.getPath("userData"), "logs");
        const result = await saveDebugAudioCapture({
          logsDir,
          audioBuffer,
          mimeType,
          sessionId,
          jobId: Number.isSafeInteger(payload?.jobId) ? payload.jobId : null,
          outputMode,
          durationSeconds: payload?.durationSeconds == null ? null : durationSeconds,
          stopReason:
            typeof payload?.stopReason === "string" ? payload.stopReason.slice(0, 100) : null,
          stopSource:
            typeof payload?.stopSource === "string" ? payload.stopSource.slice(0, 100) : null,
          maxCaptures: 10,
        });

        debugLogger.debug(
          "Debug audio capture saved",
          {
            bytes: result.bytes,
            kept: result.kept,
            deleted: result.deleted,
            bytesKept: result.bytesKept,
            bytesDeleted: result.bytesDeleted,
          },
          "audio"
        );

        return {
          success: true,
          bytes: result.bytes,
          kept: result.kept,
          deleted: result.deleted,
          bytesKept: result.bytesKept,
          bytesDeleted: result.bytesDeleted,
        };
      });
    } catch (error) {
      debugLogger.error("Debug audio capture save failed", {
        errorCategory: error?.code || error?.name || "unknown",
      });
      return { success: false, error: "Debug audio capture could not be saved" };
    }
  });
}

module.exports = { createAsyncMutex, registerDebugLoggingHandlers };
