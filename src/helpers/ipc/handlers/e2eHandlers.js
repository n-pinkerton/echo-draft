const {
  dedupeDictionaryWords,
  parseDictionaryWords,
  stripDictionaryHeader,
} = require("../utils/dictionaryUtils");
const { isPathWithin } = require("../utils/pathUtils");
const {
  flattenTranscriptionRow,
  serializeTranscriptionCsv,
} = require("../utils/transcriptionExport");

function registerE2eHandlers(
  { ipcMain, app, fs, path, globalShortcut },
  { databaseManager, windowManager, trayManager }
) {
  const e2eBaseDir = path.join(app.getPath("temp"), "echodraft-e2e");
  const resolveE2eFilePath = (filePath) => {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new Error("filePath is required");
    }

    const resolved = path.resolve(e2eBaseDir, filePath);
    if (!isPathWithin(e2eBaseDir, resolved)) {
      throw new Error("filePath must be within the EchoDraft E2E temp directory");
    }

    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    return resolved;
  };

  ipcMain.handle("e2e-export-transcriptions", async (_event, payload = {}) => {
    const exportFormat = payload?.format === "csv" ? "csv" : "json";
    const outputPath = resolveE2eFilePath(payload?.filePath || "");

    const rows = databaseManager.getAllTranscriptions();
    const flattened = rows.map((row) => flattenTranscriptionRow(row));

    if (exportFormat === "json") {
      fs.writeFileSync(outputPath, JSON.stringify(flattened, null, 2), "utf8");
      return {
        success: true,
        format: exportFormat,
        filePath: outputPath,
        count: flattened.length,
      };
    }

    fs.writeFileSync(outputPath, serializeTranscriptionCsv(flattened), "utf8");

    return {
      success: true,
      format: exportFormat,
      filePath: outputPath,
      count: flattened.length,
    };
  });

  ipcMain.handle("e2e-export-dictionary", async (_event, payload = {}) => {
    const exportFormat = payload?.format === "csv" ? "csv" : "txt";
    const outputPath = resolveE2eFilePath(payload?.filePath || "");

    const words = dedupeDictionaryWords(databaseManager.getDictionary());

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
      fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
    } else {
      fs.writeFileSync(outputPath, words.join("\n"), "utf8");
    }

    return { success: true, format: exportFormat, filePath: outputPath, count: words.length };
  });

  ipcMain.handle("e2e-import-dictionary", async (_event, payload = {}) => {
    const inputPath = resolveE2eFilePath(payload?.filePath || "");
    const content = fs.readFileSync(inputPath, "utf8");
    const parsedWords = stripDictionaryHeader(parseDictionaryWords(content), inputPath);
    const uniqueWords = dedupeDictionaryWords(parsedWords);
    return {
      success: true,
      filePath: inputPath,
      words: uniqueWords,
      parsedCount: parsedWords.length,
      uniqueCount: uniqueWords.length,
      duplicatesRemoved: Math.max(0, parsedWords.length - uniqueWords.length),
    };
  });

  ipcMain.handle("e2e-get-hotkey-status", async () => {
    const activationMode = windowManager?.getActivationMode?.() || "tap";
    const insertHotkey = windowManager?.hotkeyManager?.getCurrentHotkey?.() || null;
    const clipboardHotkey = windowManager?.getCurrentClipboardHotkey?.() || null;

    const normalizeAccel = (hotkey) => {
      if (!hotkey || typeof hotkey !== "string") return null;
      return hotkey.startsWith("Fn+") ? hotkey.slice(3) : hotkey;
    };

    const insertAccelerator = normalizeAccel(insertHotkey);
    const clipboardAccelerator = normalizeAccel(clipboardHotkey);

    const insertUsesNativeListener = Boolean(
      windowManager?.shouldUseWindowsNativeListener?.(insertHotkey, activationMode)
    );
    const clipboardUsesNativeListener = Boolean(
      windowManager?.shouldUseWindowsNativeListener?.(clipboardHotkey, activationMode)
    );

    const safeIsRegistered = (accelerator) => {
      if (!accelerator) {
        return false;
      }
      try {
        return globalShortcut.isRegistered(accelerator);
      } catch {
        return false;
      }
    };

    return {
      userDataPath: app.getPath("userData"),
      activationMode,
      insertHotkey,
      clipboardHotkey,
      insertUsesNativeListener,
      clipboardUsesNativeListener,
      insertNativeReady: Boolean(windowManager?.isWindowsNativeListenerReady?.("insert")),
      clipboardNativeReady: Boolean(windowManager?.isWindowsNativeListenerReady?.("clipboard")),
      insertGlobalRegistered: safeIsRegistered(insertAccelerator),
      clipboardGlobalRegistered: safeIsRegistered(clipboardAccelerator),
      windowsPushToTalkAvailable: Boolean(windowManager?.windowsPushToTalkAvailable),
    };
  });

  ipcMain.handle("e2e-get-tray-status", async () => ({
    ...(trayManager?.dictationStatus || {}),
    statusLabel: trayManager?.getStatusLabel?.(false) || "",
  }));

  ipcMain.handle("e2e-get-main-window-state", async () => {
    const mainWindow = windowManager?.mainWindow;
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { available: false };
    }

    return {
      available: true,
      visible: mainWindow.isVisible(),
      focused: mainWindow.isFocused(),
      focusable: mainWindow.isFocusable?.() ?? null,
      alwaysOnTop: mainWindow.isAlwaysOnTop(),
      interactive: Boolean(windowManager?.isMainWindowInteractive),
      bounds: mainWindow.getBounds(),
    };
  });
}

module.exports = { registerE2eHandlers };
