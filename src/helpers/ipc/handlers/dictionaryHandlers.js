const {
  dedupeDictionaryWords,
  parseDictionaryWords,
  stripDictionaryHeader,
} = require("../utils/dictionaryUtils");
const { requireTrustedRenderer } = require("../trustedRenderer");
const { sanitizeLexicalDictionaryEntries } = require("../../../utils/dictionaryLexicon.cjs");

const MAX_IMPORTED_DICTIONARY_BYTES = 1024 * 1024;
const MAX_IMPORTED_DICTIONARY_ENTRIES = 10_000;
const MAX_IMPORTED_DICTIONARY_ENTRY_LENGTH = 200;

const dictionaryImportError = (message, code = "DICTIONARY_IMPORT_REJECTED") => {
  const error = new Error(message);
  error.code = code;
  return error;
};

async function assertNoLinkedPath(fs, path, filePath) {
  const resolved = path.resolve(filePath);
  const root = path.parse(resolved).root;
  const segments = resolved.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    // eslint-disable-next-line no-await-in-loop
    const stat = await fs.promises.lstat(current);
    if (stat.isSymbolicLink()) {
      throw dictionaryImportError("Linked dictionary paths are not allowed");
    }
  }
  return resolved;
}

const sameFileIdentity = (left, right) => {
  if (!left || !right || left.isFile() !== true || right.isFile() !== true) return false;
  if (left.size !== right.size || left.mtimeMs !== right.mtimeMs) return false;
  if (Number.isSafeInteger(left.dev) && Number.isSafeInteger(right.dev) && left.dev !== right.dev) {
    return false;
  }
  if (Number.isSafeInteger(left.ino) && Number.isSafeInteger(right.ino) && left.ino !== right.ino) {
    return false;
  }
  return true;
};

async function readStableDictionaryFile({ fs, path }, filePath) {
  const resolved = await assertNoLinkedPath(fs, path, filePath);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const handle = await fs.promises.open(resolved, flags);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw dictionaryImportError("Dictionary source must be a file");
    if (before.size < 1 || before.size > MAX_IMPORTED_DICTIONARY_BYTES) {
      throw dictionaryImportError("Dictionary file is empty or exceeds the 1 MB limit");
    }

    const buffer = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      // eslint-disable-next-line no-await-in-loop
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead < 1) break;
      offset += bytesRead;
    }
    const probe = Buffer.alloc(1);
    const { bytesRead: extraBytes } = await handle.read(probe, 0, 1, offset);
    const after = await handle.stat();
    const pathAfter = await fs.promises.lstat(resolved);
    await assertNoLinkedPath(fs, path, resolved);
    if (
      offset !== buffer.length ||
      extraBytes !== 0 ||
      !sameFileIdentity(before, after) ||
      !sameFileIdentity(before, pathAfter)
    ) {
      throw dictionaryImportError("Dictionary file changed while it was being read");
    }
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

const safeImportErrorMessage = (error) => {
  if (error?.code === "DICTIONARY_IMPORT_REJECTED") return error.message;
  return "The dictionary file could not be read safely.";
};

function registerDictionaryHandlers(
  { ipcMain, app, BrowserWindow, dialog, fs, path },
  { databaseManager, windowManager }
) {
  const requireControlPanel = (event) =>
    requireTrustedRenderer(event, windowManager, ["control-panel"]);

  ipcMain.handle("db-get-dictionary", async (event) => {
    requireControlPanel(event);
    return databaseManager.getDictionary();
  });

  ipcMain.handle("db-set-dictionary", async (event, words) => {
    requireControlPanel(event);
    if (
      !Array.isArray(words) ||
      words.length > 10_000 ||
      words.some((word) => typeof word !== "string" || word.length > 200)
    ) {
      throw new Error("Dictionary must contain at most 10,000 words of 200 characters or fewer");
    }
    const safeWords = sanitizeLexicalDictionaryEntries(words, {
      maxEntries: 10_000,
      maxEntryLength: 80,
      maxWords: 1,
    });
    if (safeWords.length !== words.length) {
      throw new Error(
        "Dictionary entries must be unique single lexical terms of 80 characters or fewer"
      );
    }
    return databaseManager.setDictionary(safeWords);
  });

  ipcMain.handle("db-import-dictionary-file", async (event) => {
    requireControlPanel(event);
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
    const fileName = path.basename(filePath);
    try {
      const content = await readStableDictionaryFile({ fs, path }, filePath);
      const parsedWords = stripDictionaryHeader(parseDictionaryWords(content), filePath);
      if (
        parsedWords.length > MAX_IMPORTED_DICTIONARY_ENTRIES ||
        parsedWords.some(
          (word) => typeof word !== "string" || word.length > MAX_IMPORTED_DICTIONARY_ENTRY_LENGTH
        )
      ) {
        throw dictionaryImportError(
          "Dictionary files may contain at most 10,000 entries of 200 characters or fewer"
        );
      }
      const uniqueWords = dedupeDictionaryWords(parsedWords);
      const safeWords = sanitizeLexicalDictionaryEntries(uniqueWords, {
        maxEntries: MAX_IMPORTED_DICTIONARY_ENTRIES,
        maxEntryLength: 80,
        maxWords: 1,
      });
      return {
        success: true,
        filePath: fileName,
        words: safeWords,
        parsedCount: parsedWords.length,
        uniqueCount: safeWords.length,
        duplicatesRemoved: Math.max(0, parsedWords.length - uniqueWords.length),
        unsupportedRemoved: Math.max(0, uniqueWords.length - safeWords.length),
      };
    } catch (error) {
      return {
        success: false,
        filePath: fileName,
        error: safeImportErrorMessage(error),
      };
    }
  });

  ipcMain.handle("db-export-dictionary", async (event, format = "txt") => {
    requireControlPanel(event);
    const exportFormat = format === "csv" ? "csv" : "txt";
    const words = dedupeDictionaryWords(databaseManager.getDictionary());
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const extension = exportFormat === "csv" ? "csv" : "txt";
    const defaultPath = path.join(
      app.getPath("documents"),
      `echodraft-dictionary-${timestamp}.${extension}`
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

module.exports = {
  MAX_IMPORTED_DICTIONARY_BYTES,
  MAX_IMPORTED_DICTIONARY_ENTRIES,
  readStableDictionaryFile,
  registerDictionaryHandlers,
};
