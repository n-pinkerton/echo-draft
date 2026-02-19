const debugLogger = require("../../debugLogger");
const { guessAudioMimeType } = require("../utils/audioMimeUtils");

function registerAudioFileHandlers(
  { ipcMain, BrowserWindow, dialog, fs, path },
  { windowManager }
) {
  ipcMain.handle("select-audio-file-for-transcription", async () => {
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

      const stats = fs.statSync(filePath);
      const buffer = fs.readFileSync(filePath);

      debugLogger.info(
        "Audio file selected for transcription",
        {
          fileName,
          extension,
          mimeType,
          sizeBytes: stats.size,
        },
        "transcription"
      );

      return {
        success: true,
        canceled: false,
        filePath,
        fileName,
        extension,
        mimeType,
        sizeBytes: stats.size,
        data: buffer,
      };
    } catch (error) {
      debugLogger.error("Failed to select audio file for transcription", {
        error: error?.message || String(error),
      });
      return { success: false, error: error?.message || String(error) };
    }
  });
}

module.exports = { registerAudioFileHandlers };

