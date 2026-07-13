const {
  dedupeDictionaryWords,
  parseDictionaryWords,
  stripDictionaryHeader,
} = require("../utils/dictionaryUtils");
const { requireTrustedRenderer } = require("../trustedRenderer");
const { sanitizeLexicalDictionaryEntries } = require("../../../utils/dictionaryLexicon.cjs");
const { readStableDictionaryFile } = require("./dictionaryHandlers");
const {
  flattenTranscriptionRow,
  serializeTranscriptionCsv,
} = require("../utils/transcriptionExport");

const E2E_SESSION_MINTS_PER_SENDER = 16;
const E2E_SESSION_MINTS_PER_RUN = 64;

const normalizeE2eRunId = (value) => {
  const runId = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(runId) ? runId : "";
};

const assertNoLinkedPathSync = (fs, path, target) => {
  const resolved = path.resolve(target);
  const root = path.parse(resolved).root;
  let current = root;
  for (const segment of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("Linked E2E paths are not allowed");
  }
  return resolved;
};

function writeExclusiveE2eFile({ fs, path }, runRoot, outputPath, content) {
  assertNoLinkedPathSync(fs, path, runRoot);
  if (path.dirname(outputPath) !== runRoot) {
    throw new Error("E2E output must be directly inside the current run directory");
  }
  if (fs.existsSync(outputPath)) throw new Error("E2E output already exists");
  const tempPath = path.join(
    runRoot,
    `.temporary-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`
  );
  let descriptor;
  let writtenStat;
  let published = false;
  let verified = false;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    writtenStat = fs.fstatSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertNoLinkedPathSync(fs, path, runRoot);
    fs.linkSync(tempPath, outputPath);
    published = true;
    const outputStat = fs.lstatSync(outputPath);
    if (
      outputStat.isSymbolicLink() ||
      !outputStat.isFile() ||
      writtenStat.dev !== outputStat.dev ||
      writtenStat.ino !== outputStat.ino
    ) {
      throw new Error("E2E output identity could not be verified");
    }
    verified = true;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (published && !verified && writtenStat) {
      try {
        const outputStat = fs.lstatSync(outputPath);
        if (outputStat.dev === writtenStat.dev && outputStat.ino === writtenStat.ino) {
          fs.unlinkSync(outputPath);
        }
      } catch {
        // Do not touch an output whose identity cannot be proven.
      }
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Best-effort cleanup of a private temporary artifact.
    }
  }
}

function registerE2eHandlers(
  { ipcMain, app, fs, path, globalShortcut },
  { databaseManager, windowManager, trayManager }
) {
  const e2eBaseDir = path.join(app.getPath("temp"), "echodraft-e2e");
  const e2eRunId = normalizeE2eRunId(process.env.OPENWHISPR_E2E_RUN_ID);
  const e2eRunRoot = e2eRunId ? path.join(e2eBaseDir, e2eRunId) : "";
  const sessionMintsBySender = new WeakMap();
  let totalSessionMints = 0;
  const resolveE2eFilePath = (filePath) => {
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new Error("filePath is required");
    }

    if (!e2eRunRoot) throw new Error("A valid E2E run capability is required");
    fs.mkdirSync(e2eRunRoot, { recursive: true, mode: 0o700 });
    assertNoLinkedPathSync(fs, path, e2eRunRoot);

    const resolved = path.resolve(e2eRunRoot, filePath);
    if (path.dirname(resolved) !== e2eRunRoot) {
      throw new Error("filePath must be directly within the current EchoDraft E2E run directory");
    }
    return resolved;
  };

  ipcMain.handle("e2e-export-transcriptions", async (event, payload = {}) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    const exportFormat = payload?.format === "csv" ? "csv" : "json";
    const outputPath = resolveE2eFilePath(payload?.filePath || "");

    const rows = databaseManager.getAllTranscriptions();
    const flattened = rows.map((row) => flattenTranscriptionRow(row));

    if (exportFormat === "json") {
      writeExclusiveE2eFile(
        { fs, path },
        e2eRunRoot,
        outputPath,
        JSON.stringify(flattened, null, 2)
      );
      return {
        success: true,
        format: exportFormat,
        filePath: outputPath,
        count: flattened.length,
      };
    }

    writeExclusiveE2eFile(
      { fs, path },
      e2eRunRoot,
      outputPath,
      serializeTranscriptionCsv(flattened)
    );

    return {
      success: true,
      format: exportFormat,
      filePath: outputPath,
      count: flattened.length,
    };
  });

  ipcMain.handle("e2e-export-dictionary", async (event, payload = {}) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
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
      writeExclusiveE2eFile({ fs, path }, e2eRunRoot, outputPath, lines.join("\n"));
    } else {
      writeExclusiveE2eFile({ fs, path }, e2eRunRoot, outputPath, words.join("\n"));
    }

    return { success: true, format: exportFormat, filePath: outputPath, count: words.length };
  });

  ipcMain.handle("e2e-import-dictionary", async (event, payload = {}) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    const inputPath = resolveE2eFilePath(payload?.filePath || "");
    const content = await readStableDictionaryFile({ fs, path }, inputPath);
    const parsedWords = stripDictionaryHeader(parseDictionaryWords(content), inputPath);
    const uniqueWords = dedupeDictionaryWords(parsedWords);
    const safeWords = sanitizeLexicalDictionaryEntries(uniqueWords, {
      maxEntries: 10_000,
      maxEntryLength: 80,
      maxWords: 1,
    });
    return {
      success: true,
      filePath: inputPath,
      words: safeWords,
      parsedCount: parsedWords.length,
      uniqueCount: safeWords.length,
      duplicatesRemoved: Math.max(0, parsedWords.length - uniqueWords.length),
      unsupportedRemoved: Math.max(0, uniqueWords.length - safeWords.length),
    };
  });

  ipcMain.handle("e2e-get-hotkey-status", async (event) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
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

  ipcMain.handle("e2e-create-dictation-session", async (event, outputMode = "insert") => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    if (!new Set(["insert", "clipboard", "file"]).has(outputMode)) {
      throw new Error("Unsupported E2E dictation output mode");
    }

    const senderMints = sessionMintsBySender.get(event.sender) || 0;
    if (senderMints >= E2E_SESSION_MINTS_PER_SENDER) {
      throw new Error("E2E dictation session sender limit reached");
    }
    if (totalSessionMints >= E2E_SESSION_MINTS_PER_RUN) {
      throw new Error("E2E dictation session run limit reached");
    }

    sessionMintsBySender.set(event.sender, senderMints + 1);
    totalSessionMints += 1;
    try {
      const payload = windowManager?.createSessionPayload?.(outputMode);
      if (!payload?.sessionId || payload.outputMode !== outputMode) {
        throw new Error("Could not create an authenticated E2E dictation session");
      }
      return payload;
    } catch {
      sessionMintsBySender.set(event.sender, senderMints);
      totalSessionMints -= 1;
      throw new Error("Could not create an authenticated E2E dictation session");
    }
  });

  ipcMain.handle("e2e-get-tray-status", async (event) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    return {
      ...(trayManager?.dictationStatus || {}),
      statusLabel: trayManager?.getStatusLabel?.(false) || "",
    };
  });

  ipcMain.handle("e2e-get-main-window-state", async (event) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
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

module.exports = {
  E2E_SESSION_MINTS_PER_RUN,
  E2E_SESSION_MINTS_PER_SENDER,
  normalizeE2eRunId,
  registerE2eHandlers,
  writeExclusiveE2eFile,
};
