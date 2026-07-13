const debugLogger = require("../../debugLogger");
const { guessAudioMimeType } = require("../utils/audioMimeUtils");
const { requireTrustedRenderer } = require("../trustedRenderer");

const MAX_SELECTED_AUDIO_BYTES = 512 * 1024 * 1024;
const AUDIO_READ_CHUNK_BYTES = 4 * 1024 * 1024;

const sameFileIdentity = (left, right) =>
  Boolean(
    left &&
    right &&
    Number.isFinite(left.dev) &&
    Number.isFinite(left.ino) &&
    left.dev === right.dev &&
    left.ino === right.ino
  );

async function readFileHandleBounded(
  fileHandle,
  expectedSize,
  { maxBytes = MAX_SELECTED_AUDIO_BYTES, chunkBytes = AUDIO_READ_CHUNK_BYTES } = {}
) {
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 1 ||
    expectedSize > maxBytes ||
    !Number.isSafeInteger(chunkBytes) ||
    chunkBytes < 1
  ) {
    throw new Error("Selected audio file size is invalid");
  }

  const chunks = [];
  let totalBytes = 0;
  while (totalBytes < expectedSize) {
    const requestedBytes = Math.min(chunkBytes, expectedSize - totalBytes);
    const chunk = Buffer.allocUnsafe(requestedBytes);
    // eslint-disable-next-line no-await-in-loop
    const { bytesRead } = await fileHandle.read(chunk, 0, requestedBytes, null);
    if (bytesRead <= 0) break;
    totalBytes += bytesRead;
    if (totalBytes > maxBytes) throw new Error("Selected audio file exceeds the size limit");
    chunks.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
  }
  if (totalBytes !== expectedSize) {
    throw new Error("Selected audio file changed while it was being read");
  }
  return Buffer.concat(chunks, totalBytes);
}

async function readSelectedAudioFile(fs, filePath) {
  const fileHandle = await fs.promises.open(filePath, "r");
  try {
    const before = await fileHandle.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_SELECTED_AUDIO_BYTES) {
      throw new Error("Selected audio file is empty, invalid, or larger than 512 MB");
    }
    const buffer = await readFileHandleBounded(fileHandle, before.size);
    const after = await fileHandle.stat();
    const pathAfter = await fs.promises.stat(filePath);
    if (
      !after.isFile() ||
      !pathAfter.isFile() ||
      !sameFileIdentity(before, after) ||
      !sameFileIdentity(before, pathAfter) ||
      after.size !== before.size ||
      pathAfter.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new Error("Selected audio file changed while it was being read");
    }
    return { buffer, stats: before };
  } finally {
    await fileHandle.close();
  }
}

function registerAudioFileHandlers(
  { ipcMain, BrowserWindow, dialog, fs, path },
  { windowManager }
) {
  ipcMain.handle("select-audio-file-for-transcription", async (event) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    try {
      const openDialogResult = await dialog.showOpenDialog(
        windowManager.controlPanelWindow || BrowserWindow.getFocusedWindow() || undefined,
        {
          properties: ["openFile"],
          filters: [
            {
              name: "Audio files",
              extensions: [
                "mp3",
                "wav",
                "m4a",
                "mp4",
                "webm",
                "ogg",
                "opus",
                "flac",
                "aac",
                "wma",
                "aif",
                "aiff",
                "caf",
              ],
            },
            { name: "All files", extensions: ["*"] },
          ],
        }
      );

      if (openDialogResult.canceled || !openDialogResult.filePaths?.length) {
        return { success: false, canceled: true };
      }

      const filePath = openDialogResult.filePaths[0];
      const fileName = path.basename(filePath);
      const extension = path.extname(fileName).slice(1).toLowerCase() || null;
      const mimeType = guessAudioMimeType(extension || "");
      const { buffer, stats } = await readSelectedAudioFile(fs, filePath);
      const displayName = extension
        ? `Selected ${extension.toUpperCase()} audio`
        : "Selected audio";

      debugLogger.info(
        "Audio file selected for transcription",
        {
          extension,
          mimeType,
          sizeBytes: stats.size,
        },
        "transcription"
      );

      return {
        success: true,
        canceled: false,
        displayName,
        extension,
        mimeType,
        sizeBytes: stats.size,
        data: buffer,
      };
    } catch (error) {
      debugLogger.error("Failed to select audio file for transcription", {
        errorCategory: error?.code || error?.name || "unknown",
      });
      return { success: false, error: "The selected audio file could not be read" };
    }
  });
}

module.exports = {
  readFileHandleBounded,
  readSelectedAudioFile,
  registerAudioFileHandlers,
  sameFileIdentity,
};
