const debugLogger = require("../../debugLogger");

function registerWhisperHandlers({ ipcMain }, { whisperManager }) {
  ipcMain.handle("transcribe-local-whisper", async (event, audioBlob, options = {}) => {
    debugLogger.log("transcribe-local-whisper called", {
      audioBlobType: typeof audioBlob,
      audioBlobSize: audioBlob?.byteLength || audioBlob?.length || 0,
      options,
    });

    try {
      const result = await whisperManager.transcribeLocalWhisper(audioBlob, options);

      debugLogger.log("Whisper result", {
        success: result.success,
        hasText: !!result.text,
        message: result.message,
        error: result.error,
      });

      // Check if no audio was detected and send appropriate event
      if (!result.success && result.message === "No audio detected") {
        debugLogger.log("Sending no-audio-detected event to renderer");
        event.sender.send("no-audio-detected");
      }

      return result;
    } catch (error) {
      debugLogger.error("Local Whisper transcription error", error);
      const errorMessage = error.message || "Unknown error";

      // Return specific error types for better user feedback
      if (errorMessage.includes("FFmpeg not found")) {
        return {
          success: false,
          error: "ffmpeg_not_found",
          message: "FFmpeg is missing. Please reinstall the app or install FFmpeg manually.",
        };
      }
      if (
        errorMessage.includes("FFmpeg conversion failed") ||
        errorMessage.includes("FFmpeg process error")
      ) {
        return {
          success: false,
          error: "ffmpeg_error",
          message: "Audio conversion failed. The recording may be corrupted.",
        };
      }
      if (errorMessage.includes("whisper.cpp not found") || errorMessage.includes("whisper-cpp")) {
        return {
          success: false,
          error: "whisper_not_found",
          message: "Whisper binary is missing. Please reinstall the app.",
        };
      }
      if (errorMessage.includes("Audio buffer is empty") || errorMessage.includes("Audio data too small")) {
        return {
          success: false,
          error: "no_audio_data",
          message: "No audio detected",
        };
      }
      if (errorMessage.includes("model") && errorMessage.includes("not downloaded")) {
        return {
          success: false,
          error: "model_not_found",
          message: errorMessage,
        };
      }

      throw error;
    }
  });

  ipcMain.handle("check-whisper-installation", async () => {
    return whisperManager.checkWhisperInstallation();
  });

  ipcMain.handle("get-audio-diagnostics", async () => {
    return whisperManager.getDiagnostics();
  });

  ipcMain.handle("download-whisper-model", async (event, modelName) => {
    return whisperManager.downloadWhisperModel(modelName, (progressData) => {
      event.sender.send("whisper-download-progress", progressData);
    });
  });

  ipcMain.handle("check-model-status", async (_event, modelName) => {
    return whisperManager.checkModelStatus(modelName);
  });

  ipcMain.handle("list-whisper-models", async () => {
    return whisperManager.listWhisperModels();
  });

  ipcMain.handle("delete-whisper-model", async (_event, modelName) => {
    return whisperManager.deleteWhisperModel(modelName);
  });

  ipcMain.handle("delete-all-whisper-models", async () => {
    return whisperManager.deleteAllWhisperModels();
  });

  ipcMain.handle("cancel-whisper-download", async () => {
    return whisperManager.cancelDownload();
  });

  // Whisper server handlers (for faster repeated transcriptions)
  ipcMain.handle("whisper-server-start", async (_event, modelName) => {
    return whisperManager.startServer(modelName);
  });

  ipcMain.handle("whisper-server-stop", async () => {
    return whisperManager.stopServer();
  });

  ipcMain.handle("whisper-server-status", async () => {
    return whisperManager.getServerStatus();
  });

  ipcMain.handle("check-ffmpeg-availability", async () => {
    return whisperManager.checkFFmpegAvailability();
  });
}

module.exports = { registerWhisperHandlers };

