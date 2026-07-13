const debugLogger = require("../../debugLogger");
const { requireTrustedRenderer } = require("../trustedRenderer");

function registerModelManagementHandlers(
  { ipcMain },
  { environmentManager, windowManager, modelManager: injectedModelManager }
) {
  const requireControlPanel = (event) =>
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
  const getModelManager = () => injectedModelManager || require("../../modelManagerBridge").default;

  ipcMain.handle("model-get-all", async (event) => {
    requireControlPanel(event);
    try {
      debugLogger.debug("model-get-all called", undefined, "ipc");
      const modelManager = getModelManager();
      const models = await modelManager.getModelsWithStatus();
      debugLogger.debug("Returning models", { count: models.length }, "ipc");
      return models.map(({ path: _privatePath, ...model }) => model);
    } catch (error) {
      debugLogger.error("Error in model-get-all:", error);
      throw error;
    }
  });

  ipcMain.handle("model-check", async (event, modelId) => {
    requireControlPanel(event);
    const modelManager = getModelManager();
    return modelManager.isModelDownloaded(modelId);
  });

  ipcMain.handle("model-download", async (event, modelId) => {
    requireControlPanel(event);
    try {
      const modelManager = getModelManager();
      await modelManager.downloadModel(modelId, (progress, downloadedSize, totalSize) => {
        event.sender.send("model-download-progress", {
          modelId,
          progress,
          downloadedSize,
          totalSize,
        });
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details,
      };
    }
  });

  ipcMain.handle("model-delete", async (event, modelId) => {
    requireControlPanel(event);
    try {
      const modelManager = getModelManager();
      await modelManager.deleteModel(modelId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details,
      };
    }
  });

  ipcMain.handle("model-delete-all", async (event) => {
    requireControlPanel(event);
    try {
      const modelManager = getModelManager();
      await modelManager.deleteAllModels();
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details,
      };
    }
  });

  ipcMain.handle("model-cancel-download", async (event, modelId) => {
    requireControlPanel(event);
    try {
      const modelManager = getModelManager();
      const cancelled = modelManager.cancelDownload(modelId);
      return { success: cancelled };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  ipcMain.handle("model-check-runtime", async (event) => {
    requireControlPanel(event);
    try {
      const modelManager = getModelManager();
      await modelManager.ensureLlamaCpp();
      return { available: true };
    } catch (error) {
      return {
        available: false,
        error: error.message,
        code: error.code,
        details: error.details,
      };
    }
  });

  ipcMain.handle("save-gemini-key", async (event, key) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    return environmentManager.saveGeminiKey(key);
  });

  ipcMain.handle("save-groq-key", async (event, key) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    return environmentManager.saveGroqKey(key);
  });

  ipcMain.handle("save-mistral-key", async (event, key) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    return environmentManager.saveMistralKey(key);
  });

  ipcMain.handle("save-custom-transcription-key", async (event, key) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    return environmentManager.saveCustomTranscriptionKey(key);
  });

  ipcMain.handle("save-custom-reasoning-key", async (event, key) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    return environmentManager.saveCustomReasoningKey(key);
  });
}

module.exports = { registerModelManagementHandlers };
