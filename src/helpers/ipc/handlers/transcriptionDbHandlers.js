const {
  flattenTranscriptionRow,
  serializeTranscriptionCsv,
} = require("../utils/transcriptionExport");

function registerTranscriptionDbHandlers(
  { ipcMain, app, BrowserWindow, dialog, fs, path },
  { databaseManager, windowManager, broadcastToWindows }
) {
  ipcMain.handle("db-save-transcription", async (_event, payload) => {
    const result = databaseManager.saveTranscription(payload);
    if (result?.success && result?.transcription) {
      setImmediate(() => {
        broadcastToWindows("transcription-added", result.transcription);
      });
    }
    return result;
  });

  ipcMain.handle("db-get-transcriptions", async (_event, limit = 50) => {
    return databaseManager.getTranscriptions(limit);
  });

  ipcMain.handle("db-get-latest-transcription", async () => {
    return databaseManager.getLatestTranscription();
  });

  ipcMain.handle("db-clear-transcriptions", async () => {
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

  ipcMain.handle("db-delete-transcription", async (_event, id) => {
    const result = databaseManager.deleteTranscription(id);
    if (result?.success) {
      setImmediate(() => {
        broadcastToWindows("transcription-deleted", { id });
      });
    }
    return result;
  });

  ipcMain.handle("db-patch-transcription-meta", async (_event, id, metaPatch = {}) => {
    const result = databaseManager.patchTranscriptionMeta(id, metaPatch);
    if (result?.success && result?.transcription) {
      setImmediate(() => {
        broadcastToWindows("transcription-updated", result.transcription);
      });
    }
    return result;
  });

  ipcMain.handle("db-export-transcriptions", async (_event, format = "json") => {
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
