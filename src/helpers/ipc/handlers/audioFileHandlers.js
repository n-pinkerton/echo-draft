const debugLogger = require("../../debugLogger");
const { guessAudioMimeType } = require("../utils/audioMimeUtils");
const { requireTrustedRenderer } = require("../trustedRenderer");
const {
  readFileHandleBounded,
  readStableRegularFile,
  sameFileIdentity,
} = require("../../files/stableFileRead");

const MAX_SELECTED_AUDIO_BYTES = 512 * 1024 * 1024;

async function readSelectedAudioFile(
  fs,
  filePath,
  { maxBytes = MAX_SELECTED_AUDIO_BYTES, rejectSymbolicLinks = false } = {}
) {
  return await readStableRegularFile(fs, filePath, {
    maxBytes,
    rejectSymbolicLinks,
  });
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
  MAX_SELECTED_AUDIO_BYTES,
  readFileHandleBounded,
  readSelectedAudioFile,
  registerAudioFileHandlers,
  sameFileIdentity,
};
