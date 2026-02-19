const { dedupeDictionaryWords, parseDictionaryWords, stripDictionaryHeader } = require("../utils/dictionaryUtils");
const { isPathWithin } = require("../utils/pathUtils");

function registerE2eHandlers(
  { ipcMain, app, fs, path, globalShortcut },
  { databaseManager, windowManager }
) {
  const e2eBaseDir = path.join(app.getPath("temp"), "openwhispr-e2e");
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
    const flattened = rows.map((row) => {
      const meta = row?.meta || {};
      const timings = meta?.timings || {};
      return {
        id: row.id,
        timestamp: row.timestamp,
        text: row.text || "",
        rawText: row.raw_text || "",
        outputMode: meta.outputMode || "",
        status: meta.status || "",
        provider: meta.provider || meta.source || "",
        model: meta.model || "",
        source: meta.source || "",
        pasteSucceeded:
          meta.pasteSucceeded === true ? "true" : meta.pasteSucceeded === false ? "false" : "",
        error: meta.error || "",
        recordMs: timings.recordDurationMs ?? timings.recordMs ?? "",
        transcribeMs: timings.transcriptionProcessingDurationMs ?? timings.transcribeDurationMs ?? "",
        cleanupMs: timings.reasoningProcessingDurationMs ?? timings.cleanupDurationMs ?? "",
        pasteMs: timings.pasteDurationMs ?? "",
        saveMs: timings.saveDurationMs ?? "",
        totalMs: timings.totalDurationMs ?? "",
      };
    });

    if (exportFormat === "json") {
      fs.writeFileSync(outputPath, JSON.stringify(flattened, null, 2), "utf8");
      return {
        success: true,
        format: exportFormat,
        filePath: outputPath,
        count: flattened.length,
      };
    }

    const headers = Object.keys(flattened[0] || { id: "", timestamp: "", text: "" });
    const escapeCsvValue = (value) => {
      const raw = value === null || value === undefined ? "" : String(value);
      if (!/[",\n]/.test(raw)) {
        return raw;
      }
      return `"${raw.replace(/"/g, '""')}"`;
    };

    const csvRows = [headers.join(",")];
    for (const row of flattened) {
      csvRows.push(headers.map((header) => escapeCsvValue(row[header])).join(","));
    }
    fs.writeFileSync(outputPath, csvRows.join("\n"), "utf8");

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

    const safeIsRegistered = (accelerator, usesNativeListener) => {
      if (!accelerator || usesNativeListener) {
        return false;
      }
      try {
        return globalShortcut.isRegistered(accelerator);
      } catch {
        return false;
      }
    };

    return {
      activationMode,
      insertHotkey,
      clipboardHotkey,
      insertUsesNativeListener,
      clipboardUsesNativeListener,
      insertGlobalRegistered: safeIsRegistered(insertAccelerator, insertUsesNativeListener),
      clipboardGlobalRegistered: safeIsRegistered(clipboardAccelerator, clipboardUsesNativeListener),
      windowsPushToTalkAvailable: Boolean(windowManager?.windowsPushToTalkAvailable),
    };
  });
}

module.exports = { registerE2eHandlers };
