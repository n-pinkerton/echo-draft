const {
  flattenTranscriptionRow,
  serializeTranscriptionCsv,
} = require("../utils/transcriptionExport");
const { requireTrustedRenderer } = require("../trustedRenderer");

function registerTranscriptionDbHandlers(
  { ipcMain, app, BrowserWindow, dialog, fs, path },
  { databaseManager, windowManager, broadcastToWindows }
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
    if (typeof rawText === "string" && rawText.length > 1_000_000) {
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
