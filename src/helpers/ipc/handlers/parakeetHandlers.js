const debugLogger = require("../../debugLogger");
const { requireTrustedRenderer } = require("../trustedRenderer");
const { getValidParakeetModelNames } = require("../../parakeet/modelRegistry");
const { requireLanguageCode } = require("../../../utils/languagePolicy.cjs");

const LOCAL_PARAKEET_OPTION_FIELDS = new Set(["model", "language"]);
const LOCAL_PARAKEET_MODELS = new Set(getValidParakeetModelNames());

const normalizeLocalParakeetOptions = (value = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local Parakeet options must be an object");
  }
  if (Object.keys(value).some((key) => !LOCAL_PARAKEET_OPTION_FIELDS.has(key))) {
    throw new Error("Local Parakeet options contain unsupported fields");
  }
  const model =
    typeof value.model === "string" && value.model.trim()
      ? value.model.trim()
      : "parakeet-tdt-0.6b-v3";
  if (!LOCAL_PARAKEET_MODELS.has(model)) throw new Error("Unsupported local Parakeet model");
  const language = requireLanguageCode(
    value.language,
    { allowAuto: true, capability: "parakeet", baseOnly: true },
    "local Parakeet language"
  );
  return { model, ...(language ? { language } : {}) };
};

function registerParakeetHandlers(
  { ipcMain },
  { parakeetManager, environmentManager, cancelableRequests, windowManager }
) {
  const requireControlPanel = (event) =>
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
  ipcMain.handle("transcribe-local-parakeet", async (event, audioBlob, options = {}, requestId) => {
    requireTrustedRenderer(event, windowManager);
    let requestScope;

    try {
      const safeOptions = normalizeLocalParakeetOptions(options);
      debugLogger.log("transcribe-local-parakeet called", {
        audioBlobType: typeof audioBlob,
        audioBlobSize: audioBlob?.byteLength || audioBlob?.length || 0,
        model: safeOptions.model,
        language: safeOptions.language || "auto",
      });
      requestScope = cancelableRequests.createScope(event, requestId);
      const result = await parakeetManager.transcribeLocalParakeet(audioBlob, safeOptions, {
        signal: requestScope.signal,
      });

      debugLogger.log("Parakeet result", {
        success: result.success,
        hasText: !!result.text,
        message: result.message,
        error: result.error,
      });

      if (!result.success && result.message === "No audio detected") {
        debugLogger.log("Sending no-audio-detected event to renderer");
        event.sender.send("no-audio-detected");
      }

      return result;
    } catch (error) {
      if (requestScope?.signal.aborted || error?.name === "AbortError") {
        return { success: false, error: "Request cancelled", code: "REQUEST_CANCELLED" };
      }
      debugLogger.error("Local Parakeet transcription error", error);
      const errorMessage = error.message || "Unknown error";

      if (errorMessage.includes("sherpa-onnx") && errorMessage.includes("not found")) {
        return {
          success: false,
          error: "parakeet_not_found",
          message: "Parakeet binary is missing. Please reinstall the app.",
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

  ipcMain.handle("check-parakeet-installation", async (event) => {
    requireControlPanel(event);
    return parakeetManager.checkInstallation();
  });

  ipcMain.handle("download-parakeet-model", async (event, modelName) => {
    requireControlPanel(event);
    return parakeetManager.downloadParakeetModel(modelName, (progressData) => {
      event.sender.send("parakeet-download-progress", progressData);
    });
  });

  ipcMain.handle("check-parakeet-model-status", async (event, modelName) => {
    requireControlPanel(event);
    return parakeetManager.checkModelStatus(modelName);
  });

  ipcMain.handle("list-parakeet-models", async (event) => {
    requireControlPanel(event);
    return parakeetManager.listParakeetModels();
  });

  ipcMain.handle("delete-parakeet-model", async (event, modelName) => {
    requireControlPanel(event);
    return parakeetManager.deleteParakeetModel(modelName);
  });

  ipcMain.handle("delete-all-parakeet-models", async (event) => {
    requireControlPanel(event);
    return parakeetManager.deleteAllParakeetModels();
  });

  ipcMain.handle("cancel-parakeet-download", async (event) => {
    requireControlPanel(event);
    return parakeetManager.cancelDownload();
  });

  ipcMain.handle("get-parakeet-diagnostics", async (event) => {
    requireControlPanel(event);
    return parakeetManager.getDiagnostics();
  });

  // Parakeet server handlers (for faster repeated transcriptions)
  ipcMain.handle("parakeet-server-start", async (event, modelName) => {
    requireControlPanel(event);
    const result = await parakeetManager.startServer(modelName);
    process.env.LOCAL_TRANSCRIPTION_PROVIDER = "nvidia";
    process.env.PARAKEET_MODEL = modelName;
    environmentManager.saveAllKeysToEnvFile();
    return result;
  });

  ipcMain.handle("parakeet-server-stop", async (event) => {
    requireControlPanel(event);
    const result = await parakeetManager.stopServer();
    delete process.env.LOCAL_TRANSCRIPTION_PROVIDER;
    delete process.env.PARAKEET_MODEL;
    environmentManager.saveAllKeysToEnvFile();
    return result;
  });

  ipcMain.handle("parakeet-server-status", async (event) => {
    requireControlPanel(event);
    return parakeetManager.getServerStatus();
  });
}

module.exports = { normalizeLocalParakeetOptions, registerParakeetHandlers };
