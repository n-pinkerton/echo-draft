const { requireTrustedRenderer } = require("../trustedRenderer");
const {
  audioCaptureMutex,
  createAsyncMutex,
} = require("../../audio/debug/audioCaptureCoordinator");
const { createRetentionManifest, executeRetentionManifest } = require("../../retentionPurge");

const MAX_DEBUG_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_DEBUG_AUDIO_DURATION_SECONDS = 30 * 60;
const ALLOWED_DEBUG_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
]);

function registerDebugLoggingHandlers(
  {
    ipcMain,
    app,
    path,
    shell,
    dialog,
    BrowserWindow,
    debugLogger,
    saveDebugAudioCapture,
    createRetentionManifest: createRetentionManifestOverride,
    executeRetentionManifest: executeRetentionManifestOverride,
  },
  { broadcastToWindows, databaseManager, environmentManager, trayManager = null, windowManager }
) {
  let purgeRequestInProgress = false;
  let retentionRequestInProgress = false;
  const buildRetentionManifest = createRetentionManifestOverride || createRetentionManifest;
  const runRetentionManifest = executeRetentionManifestOverride || executeRetentionManifest;
  const refreshRetentionConsumers = () => {
    try {
      broadcastToWindows?.("retention-data-changed", { reason: "retention" });
    } catch {
      debugLogger.error("Could not notify windows after 30-day deletion", {
        errorCategory: "retention_refresh_failed",
      });
    }
    try {
      trayManager?.updateTrayMenu?.();
    } catch {
      debugLogger.error("Could not refresh the tray after 30-day deletion", {
        errorCategory: "retention_tray_refresh_failed",
      });
    }
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
      return await audioCaptureMutex.run(async () => {
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

  ipcMain.handle("purge-data-older-than-30-days", async (event) => {
    if (retentionRequestInProgress) {
      return { success: false, busy: true, error: "30-day deletion is already in progress" };
    }
    const senderWindow = getTrustedControlPanelWindow(event);
    if (!senderWindow) {
      return { success: false, error: "30-day deletion requires the EchoDraft control panel" };
    }

    retentionRequestInProgress = true;
    let executionStarted = false;
    try {
      return await audioCaptureMutex.run(async () => {
        const manifest = await buildRetentionManifest({ databaseManager, debugLogger });
        const summary = manifest.summary;
        const firstConfirmation = await dialog.showMessageBox(senderWindow, {
          type: "warning",
          title: "Delete logs and transcripts older than 30 days?",
          message: "Review the permanent 30-day deletion",
          detail:
            `Cutoff: ${manifest.cutoffIso} (UTC).\n\n` +
            `Included: ${summary.history} History item${summary.history === 1 ? "" : "s"}; ` +
            `${summary.todos} To Do${summary.todos === 1 ? "" : "s"} ` +
            `(${summary.pendingTodos} pending, ${summary.actionedTodos} actioned); ` +
            `${summary.alternatives} linked alternative${summary.alternatives === 1 ? "" : "s"}; ` +
            `${summary.correctionFlags} linked correction flag${summary.correctionFlags === 1 ? "" : "s"}; ` +
            `${summary.logFiles} verified desktop log file${summary.logFiles === 1 ? "" : "s"} ` +
            `(${summary.logBytes} bytes).\n\n` +
            "Excluded: the active log, newer and unrelated files, captured audio, mobile inbox data, correction rules, and app style profiles. This deletion is permanent and has no backup or undo.",
          buttons: ["Cancel", "Continue"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (firstConfirmation.response !== 1) {
          return { success: false, cancelled: true };
        }

        const finalConfirmation = await dialog.showMessageBox(senderWindow, {
          type: "warning",
          title: "Final confirmation",
          message: "Permanently delete the reviewed data?",
          detail:
            `Delete exactly the previewed ${summary.history} History item${summary.history === 1 ? "" : "s"}, ` +
            `${summary.todos} To Do${summary.todos === 1 ? "" : "s"}, and ` +
            `${summary.logFiles} desktop log file${summary.logFiles === 1 ? "" : "s"} ` +
            `strictly older than ${manifest.cutoffIso}? EchoDraft rechecks the whole preview before starting and reports any later partial filesystem failure.`,
          buttons: ["Cancel", "Permanently Delete"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (finalConfirmation.response !== 1) {
          return { success: false, cancelled: true };
        }

        executionStarted = true;
        const result = await runRetentionManifest({ manifest, databaseManager, debugLogger });
        if (result.database?.success) {
          refreshRetentionConsumers();
        }
        return {
          ...result,
          error: result.success
            ? undefined
            : result.errors?.join("; ") || "30-day deletion was incomplete",
        };
      });
    } catch (error) {
      if (executionStarted) {
        refreshRetentionConsumers();
      }
      debugLogger.error("30-day deletion failed", {
        errorCategory: error?.code || error?.name || "unknown",
      });
      const errorMessage = executionStarted
        ? "EchoDraft could not confirm the complete deletion result. Review History, To Do, and the logs folder before trying again."
        : error?.message || String(error);
      return {
        success: false,
        aborted: !executionStarted,
        uncertain: executionStarted,
        error: errorMessage,
      };
    } finally {
      retentionRequestInProgress = false;
    }
  });

  ipcMain.handle("debug-save-audio", async (event, payload = {}) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    if (debugLogger.isArtifactPurgeInProgress?.()) {
      return { success: false, skipped: true, reason: "purge-in-progress" };
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

      return await audioCaptureMutex.run(async () => {
        if (!windowManager?.isIssuedDictationSession?.(sessionId, outputMode)) {
          return { success: false, error: "Debug audio session is invalid or expired" };
        }
        if (!windowManager?.claimDebugAudioSession?.(sessionId, outputMode)) {
          return { success: false, error: "Debug audio session was already used" };
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
