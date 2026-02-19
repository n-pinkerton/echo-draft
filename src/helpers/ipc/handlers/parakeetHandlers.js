const debugLogger = require("../../debugLogger");

function registerParakeetHandlers(
  { ipcMain },
  { parakeetManager, environmentManager }
) {
  ipcMain.handle("transcribe-local-parakeet", async (event, audioBlob, options = {}) => {
    debugLogger.log("transcribe-local-parakeet called", {
      audioBlobType: typeof audioBlob,
      audioBlobSize: audioBlob?.byteLength || audioBlob?.length || 0,
      options,
    });

    try {
      const result = await parakeetManager.transcribeLocalParakeet(audioBlob, options);

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
    }
  });

  ipcMain.handle("check-parakeet-installation", async () => {
    return parakeetManager.checkInstallation();
  });

  ipcMain.handle("download-parakeet-model", async (event, modelName) => {
    return parakeetManager.downloadParakeetModel(modelName, (progressData) => {
      event.sender.send("parakeet-download-progress", progressData);
    });
  });

  ipcMain.handle("check-parakeet-model-status", async (_event, modelName) => {
    return parakeetManager.checkModelStatus(modelName);
  });

  ipcMain.handle("list-parakeet-models", async () => {
    return parakeetManager.listParakeetModels();
  });

  ipcMain.handle("delete-parakeet-model", async (_event, modelName) => {
    return parakeetManager.deleteParakeetModel(modelName);
  });

  ipcMain.handle("delete-all-parakeet-models", async () => {
    return parakeetManager.deleteAllParakeetModels();
  });

  ipcMain.handle("cancel-parakeet-download", async () => {
    return parakeetManager.cancelDownload();
  });

  ipcMain.handle("get-parakeet-diagnostics", async () => {
    return parakeetManager.getDiagnostics();
  });

  // Parakeet server handlers (for faster repeated transcriptions)
  ipcMain.handle("parakeet-server-start", async (_event, modelName) => {
    const result = await parakeetManager.startServer(modelName);
    process.env.LOCAL_TRANSCRIPTION_PROVIDER = "nvidia";
    process.env.PARAKEET_MODEL = modelName;
    environmentManager.saveAllKeysToEnvFile();
    return result;
  });

  ipcMain.handle("parakeet-server-stop", async () => {
    const result = await parakeetManager.stopServer();
    delete process.env.LOCAL_TRANSCRIPTION_PROVIDER;
    delete process.env.PARAKEET_MODEL;
    environmentManager.saveAllKeysToEnvFile();
    return result;
  });

  ipcMain.handle("parakeet-server-status", async () => {
    return parakeetManager.getServerStatus();
  });
}

module.exports = { registerParakeetHandlers };

