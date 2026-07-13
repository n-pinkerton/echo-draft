const debugLogger = require("../../debugLogger");
const { requireTrustedRenderer } = require("../trustedRenderer");
const { sanitizeLexicalDictionaryEntries } = require("../../../utils/dictionaryLexicon.cjs");
const { requireLanguageCode } = require("../../../utils/languagePolicy.cjs");

const LOCAL_WHISPER_OPTION_FIELDS = new Set(["model", "language", "dictionaryEntries"]);

function normalizeLocalWhisperOptions(whisperManager, value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local Whisper options must be an object");
  }
  const unknownFields = Object.keys(value).filter((key) => !LOCAL_WHISPER_OPTION_FIELDS.has(key));
  if (unknownFields.length > 0) {
    throw new Error("Local Whisper options contain unsupported fields");
  }

  const model = typeof value.model === "string" && value.model.trim() ? value.model.trim() : "base";
  whisperManager.validateModelName?.(model);
  const language =
    requireLanguageCode(
      value.language,
      { allowAuto: false, capability: "whisper", baseOnly: true },
      "local Whisper language"
    ) || "";

  let dictionaryEntries = [];
  if (value.dictionaryEntries !== undefined) {
    if (!Array.isArray(value.dictionaryEntries) || value.dictionaryEntries.length > 100) {
      throw new Error("Invalid local Whisper dictionary entries");
    }
    dictionaryEntries = sanitizeLexicalDictionaryEntries(value.dictionaryEntries, {
      maxEntries: 100,
      maxEntryLength: 80,
      maxWords: 1,
    });
    if (dictionaryEntries.length !== value.dictionaryEntries.length) {
      throw new Error("Local Whisper dictionary must contain unique lexical terms only");
    }
  }

  return {
    model,
    ...(language ? { language } : {}),
    ...(dictionaryEntries.length > 0 ? { dictionaryEntries } : {}),
  };
}

function registerWhisperHandlers(
  { ipcMain },
  { whisperManager, cancelableRequests, windowManager }
) {
  const requireControlPanel = (event) =>
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
  ipcMain.handle("transcribe-local-whisper", async (event, audioBlob, options = {}, requestId) => {
    requireTrustedRenderer(event, windowManager);
    let requestScope;

    try {
      const safeOptions = normalizeLocalWhisperOptions(whisperManager, options);
      debugLogger.log("transcribe-local-whisper called", {
        audioBlobType: typeof audioBlob,
        audioBlobSize: audioBlob?.byteLength || audioBlob?.length || 0,
        model: safeOptions.model,
        language: safeOptions.language || "auto",
        dictionaryEntryCount: safeOptions.dictionaryEntries?.length || 0,
      });
      requestScope = cancelableRequests.createScope(event, requestId);
      const result = await whisperManager.transcribeLocalWhisper(audioBlob, safeOptions, {
        signal: requestScope.signal,
      });

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
      if (requestScope?.signal.aborted || error?.name === "AbortError") {
        return { success: false, error: "Request cancelled", code: "REQUEST_CANCELLED" };
      }
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
      if (
        errorMessage.includes("Audio buffer is empty") ||
        errorMessage.includes("Audio data too small")
      ) {
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
    } finally {
      requestScope?.finish();
    }
  });

  ipcMain.handle("check-whisper-installation", async (event) => {
    requireControlPanel(event);
    return whisperManager.checkWhisperInstallation();
  });

  ipcMain.handle("get-audio-diagnostics", async (event) => {
    requireControlPanel(event);
    return whisperManager.getDiagnostics();
  });

  ipcMain.handle("download-whisper-model", async (event, modelName) => {
    requireControlPanel(event);
    return whisperManager.downloadWhisperModel(modelName, (progressData) => {
      event.sender.send("whisper-download-progress", progressData);
    });
  });

  ipcMain.handle("check-model-status", async (event, modelName) => {
    requireControlPanel(event);
    return whisperManager.checkModelStatus(modelName);
  });

  ipcMain.handle("list-whisper-models", async (event) => {
    requireControlPanel(event);
    return whisperManager.listWhisperModels();
  });

  ipcMain.handle("delete-whisper-model", async (event, modelName) => {
    requireControlPanel(event);
    return whisperManager.deleteWhisperModel(modelName);
  });

  ipcMain.handle("delete-all-whisper-models", async (event) => {
    requireControlPanel(event);
    return whisperManager.deleteAllWhisperModels();
  });

  ipcMain.handle("cancel-whisper-download", async (event) => {
    requireControlPanel(event);
    return whisperManager.cancelDownload();
  });

  // Whisper server handlers (for faster repeated transcriptions)
  ipcMain.handle("whisper-server-start", async (event, modelName) => {
    requireControlPanel(event);
    return whisperManager.startServer(modelName);
  });

  ipcMain.handle("whisper-server-stop", async (event) => {
    requireControlPanel(event);
    return whisperManager.stopServer();
  });

  ipcMain.handle("whisper-server-status", async (event) => {
    requireControlPanel(event);
    return whisperManager.getServerStatus();
  });

  ipcMain.handle("check-ffmpeg-availability", async (event) => {
    requireControlPanel(event);
    return whisperManager.checkFFmpegAvailability();
  });
}

module.exports = { normalizeLocalWhisperOptions, registerWhisperHandlers };
