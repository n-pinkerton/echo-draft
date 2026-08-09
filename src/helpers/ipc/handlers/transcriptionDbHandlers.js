const {
  flattenTranscriptionRow,
  serializeTranscriptionCsv,
} = require("../utils/transcriptionExport");
const { requireTrustedRenderer } = require("../trustedRenderer");
const { MAX_TODO_PAGE_SIZE } = require("../../todoPayload");

const requireSmallObject = (value, label, maxBytes = 16_384) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes) {
    throw new Error(`${label} is too large`);
  }
  return value;
};

function registerTranscriptionDbHandlers(
  { ipcMain, app, BrowserWindow, dialog, fs, path },
  { databaseManager, windowManager, broadcastToWindows, trayManager = null }
) {
  const requireControlPanel = (event) =>
    requireTrustedRenderer(event, windowManager, ["control-panel"]);

  ipcMain.handle("db-save-transcription", async (event, payload) => {
    requireTrustedRenderer(event, windowManager);
    const text = typeof payload === "string" ? payload : payload?.text;
    const rawText = typeof payload === "object" ? payload?.rawText : null;
    if (typeof text !== "string" || text.length < 1 || text.length > 1_000_000) {
      throw new Error("Invalid transcription payload");
    }
    if (typeof rawText !== "string" || !rawText.trim()) {
      throw new Error("Raw transcription is required");
    }
    if (rawText.length > 1_000_000) {
      throw new Error("Raw transcription is too large");
    }
    if (
      typeof payload === "object" &&
      payload?.meta &&
      Buffer.byteLength(JSON.stringify(payload.meta), "utf8") > 1_000_000
    ) {
      throw new Error("Transcription metadata is too large");
    }
    const result = databaseManager.saveTranscription(payload);
    if (result?.success && result?.transcription) {
      setImmediate(() => {
        broadcastToWindows("transcription-added", result.transcription);
      });
    }
    return result;
  });

  ipcMain.handle("db-get-transcriptions", async (event, limit = 50) => {
    requireControlPanel(event);
    const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(500, limit)) : 50;
    return databaseManager.getTranscriptions(safeLimit);
  });

  ipcMain.handle("db-get-latest-transcription", async (event) => {
    requireControlPanel(event);
    return databaseManager.getLatestTranscription();
  });

  ipcMain.handle("db-get-pending-todos", async (event, limit = MAX_TODO_PAGE_SIZE) => {
    requireControlPanel(event);
    const safeLimit = Number.isInteger(limit)
      ? Math.max(1, Math.min(MAX_TODO_PAGE_SIZE, limit))
      : MAX_TODO_PAGE_SIZE;
    return databaseManager.getPendingTodos(safeLimit);
  });

  ipcMain.handle("db-mark-todo-actioned", async (event, id) => {
    requireControlPanel(event);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid To Do ID");
    const result = databaseManager.markTodoActioned(id);
    if (result?.success) {
      try {
        trayManager?.updateTrayMenu?.();
      } catch {
        console.error("Failed to refresh the tray after actioning a To Do");
      }
    }
    return result;
  });

  ipcMain.handle("db-get-archived-todos", async (event, options = {}) => {
    requireControlPanel(event);
    requireSmallObject(options, "Archived To Do options");
    const allowed = new Set(["query", "cursor", "limit"]);
    if (Object.keys(options).some((key) => !allowed.has(key))) {
      throw new Error("Archived To Do options contain unsupported fields");
    }
    const limit = options.limit === undefined ? 25 : options.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TODO_PAGE_SIZE) {
      throw new Error("Invalid Archived To Do page size");
    }
    if (typeof (options.query ?? "") !== "string") {
      throw new Error("Invalid Archived To Do search");
    }
    return databaseManager.getArchivedTodos({ ...options, limit });
  });

  ipcMain.handle("db-save-reprocessing-alternative", async (event, payload) => {
    requireControlPanel(event);
    requireSmallObject(payload, "reprocessing alternative", 1_100_000);
    return databaseManager.saveReprocessingAlternative(payload);
  });

  ipcMain.handle("db-get-correction-rules", async (event) => {
    requireControlPanel(event);
    return databaseManager.getCorrectionRules();
  });

  ipcMain.handle("db-get-writing-preferences", async (event, processName = null) => {
    requireTrustedRenderer(event, windowManager);
    if (processName !== null && (typeof processName !== "string" || processName.length > 128)) {
      throw new Error("Invalid application process name");
    }
    return databaseManager.getWritingPreferences(processName);
  });

  ipcMain.handle("db-save-correction-rule", async (event, payload) => {
    requireControlPanel(event);
    requireSmallObject(payload, "correction rule");
    return databaseManager.saveCorrectionRule(payload);
  });

  ipcMain.handle("db-delete-correction-rule", async (event, id) => {
    requireControlPanel(event);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid correction rule ID");
    return databaseManager.deleteCorrectionRule(id);
  });

  ipcMain.handle("db-get-app-style-profiles", async (event) => {
    requireControlPanel(event);
    return databaseManager.getAppStyleProfiles();
  });

  ipcMain.handle("db-save-app-style-profile", async (event, payload) => {
    requireControlPanel(event);
    requireSmallObject(payload, "application style profile");
    return databaseManager.saveAppStyleProfile(payload);
  });

  ipcMain.handle("db-delete-app-style-profile", async (event, id) => {
    requireControlPanel(event);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error("Invalid application style profile ID");
    }
    return databaseManager.deleteAppStyleProfile(id);
  });

  ipcMain.handle("db-set-correction-flag", async (event, payload) => {
    requireControlPanel(event);
    requireSmallObject(payload, "correction flag");
    return databaseManager.setCorrectionFlag(payload);
  });

  ipcMain.handle("db-clear-correction-flag", async (event, payload) => {
    requireControlPanel(event);
    requireSmallObject(payload, "correction flag source");
    return databaseManager.clearCorrectionFlag(payload);
  });

  ipcMain.handle("db-clear-transcriptions", async (event) => {
    requireControlPanel(event);
    const result = databaseManager.clearTranscriptions();
    if (result?.success) {
      setImmediate(() => {
        broadcastToWindows("transcriptions-cleared", {
          cleared: result.cleared,
        });
      });
    }
    return result;
  });

  ipcMain.handle("db-delete-transcription", async (event, id) => {
    requireControlPanel(event);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid transcription ID");
    const result = databaseManager.deleteTranscription(id);
    if (result?.success) {
      setImmediate(() => {
        broadcastToWindows("transcription-deleted", { id });
      });
    }
    return result;
  });

  ipcMain.handle("db-patch-transcription-meta", async (event, id, metaPatch = {}) => {
    requireTrustedRenderer(event, windowManager);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid transcription ID");
    if (!metaPatch || typeof metaPatch !== "object" || Array.isArray(metaPatch)) {
      throw new Error("Invalid transcription metadata patch");
    }
    if (Buffer.byteLength(JSON.stringify(metaPatch), "utf8") > 256_000) {
      throw new Error("Transcription metadata patch is too large");
    }
    const result = databaseManager.patchTranscriptionMeta(id, metaPatch);
    if (result?.success && result?.transcription) {
      setImmediate(() => {
        broadcastToWindows("transcription-updated", result.transcription);
      });
    }
    return result;
  });

  ipcMain.handle("db-export-transcriptions", async (event, format = "json") => {
    requireControlPanel(event);
    const exportFormat = format === "csv" ? "csv" : "json";
    const rows = databaseManager.getAllTranscriptions();
    const flattened = rows.map((row) => flattenTranscriptionRow(row));

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extension = exportFormat === "csv" ? "csv" : "json";
    const defaultPath = path.join(
      app.getPath("documents"),
      `echodraft-transcriptions-${timestamp}.${extension}`
    );

    const saveDialogResult = await dialog.showSaveDialog(
      windowManager.controlPanelWindow || BrowserWindow.getFocusedWindow() || undefined,
      {
        defaultPath,
        filters:
          exportFormat === "csv"
            ? [{ name: "CSV", extensions: ["csv"] }]
            : [{ name: "JSON", extensions: ["json"] }],
      }
    );

    if (saveDialogResult.canceled || !saveDialogResult.filePath) {
      return { success: false, canceled: true };
    }

    if (exportFormat === "json") {
      fs.writeFileSync(saveDialogResult.filePath, JSON.stringify(flattened, null, 2), "utf8");
      return {
        success: true,
        format: exportFormat,
        filePath: saveDialogResult.filePath,
        count: flattened.length,
      };
    }

    fs.writeFileSync(saveDialogResult.filePath, serializeTranscriptionCsv(flattened), "utf8");

    return {
      success: true,
      format: exportFormat,
      filePath: saveDialogResult.filePath,
      count: flattened.length,
    };
  });
}

module.exports = { registerTranscriptionDbHandlers };
