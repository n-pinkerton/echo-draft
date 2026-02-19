const {
  dedupeDictionaryWords,
  parseDictionaryWords,
  stripDictionaryHeader,
} = require("../utils/dictionaryUtils");

function registerDictionaryHandlers(
  { ipcMain, app, BrowserWindow, dialog, fs, path },
  { databaseManager, windowManager }
) {
  ipcMain.handle("db-get-dictionary", async () => {
    return databaseManager.getDictionary();
  });

  ipcMain.handle("db-set-dictionary", async (_event, words) => {
    if (!Array.isArray(words)) {
      throw new Error("words must be an array");
    }
    return databaseManager.setDictionary(words);
  });

  ipcMain.handle("db-import-dictionary-file", async () => {
    const openDialogResult = await dialog.showOpenDialog(
      windowManager.controlPanelWindow || BrowserWindow.getFocusedWindow() || undefined,
      {
        properties: ["openFile"],
        filters: [
          { name: "Dictionary files", extensions: ["txt", "csv", "tsv", "md"] },
          { name: "Text files", extensions: ["txt", "csv", "tsv"] },
          { name: "All files", extensions: ["*"] },
        ],
      }
    );

    if (openDialogResult.canceled || !openDialogResult.filePaths?.length) {
      return { success: false, canceled: true };
    }

    const filePath = openDialogResult.filePaths[0];
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const parsedWords = stripDictionaryHeader(parseDictionaryWords(content), filePath);
      const uniqueWords = dedupeDictionaryWords(parsedWords);
      return {
        success: true,
        filePath,
        words: uniqueWords,
        parsedCount: parsedWords.length,
        uniqueCount: uniqueWords.length,
        duplicatesRemoved: Math.max(0, parsedWords.length - uniqueWords.length),
      };
    } catch (error) {
      return {
        success: false,
        filePath,
        error: error?.message || String(error),
      };
    }
  });

  ipcMain.handle("db-export-dictionary", async (_event, format = "txt") => {
    const exportFormat = format === "csv" ? "csv" : "txt";
    const words = dedupeDictionaryWords(databaseManager.getDictionary());
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extension = exportFormat === "csv" ? "csv" : "txt";
    const defaultPath = path.join(
      app.getPath("documents"),
      `openwhispr-dictionary-${timestamp}.${extension}`
    );

    const saveDialogResult = await dialog.showSaveDialog(
      windowManager.controlPanelWindow || BrowserWindow.getFocusedWindow() || undefined,
      {
        defaultPath,
        filters:
          exportFormat === "csv"
            ? [{ name: "CSV", extensions: ["csv"] }]
            : [{ name: "Text", extensions: ["txt"] }],
      }
    );

    if (saveDialogResult.canceled || !saveDialogResult.filePath) {
      return { success: false, canceled: true };
    }

    if (exportFormat === "csv") {
      const escapeCsvValue = (value) => {
        const raw = value === null || value === undefined ? "" : String(value);
        if (!/[",\n]/.test(raw)) {
          return raw;
        }
        return `"${raw.replace(/"/g, '""')}"`;
      };
      const lines = ["word"];
      for (const word of words) {
        lines.push(escapeCsvValue(word));
      }
      fs.writeFileSync(saveDialogResult.filePath, lines.join("\n"), "utf8");
    } else {
      fs.writeFileSync(saveDialogResult.filePath, words.join("\n"), "utf8");
    }

    return {
      success: true,
      format: exportFormat,
      filePath: saveDialogResult.filePath,
      count: words.length,
    };
  });
}

module.exports = { registerDictionaryHandlers };

