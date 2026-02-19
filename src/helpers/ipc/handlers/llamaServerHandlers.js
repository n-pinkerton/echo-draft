const path = require("path");

function registerLlamaServerHandlers({ ipcMain }) {
  ipcMain.handle("llama-server-start", async (_event, modelId) => {
    try {
      const modelManager = require("../../modelManagerBridge").default;
      const modelInfo = modelManager.findModelById(modelId);
      if (!modelInfo) {
        return { success: false, error: `Model \"${modelId}\" not found` };
      }

      const modelPath = path.join(modelManager.modelsDir, modelInfo.model.fileName);

      await modelManager.serverManager.start(modelPath, {
        contextSize: modelInfo.model.contextLength || 4096,
        threads: 4,
      });
      modelManager.currentServerModelId = modelId;

      return { success: true, port: modelManager.serverManager.port };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("llama-server-stop", async () => {
    try {
      const modelManager = require("../../modelManagerBridge").default;
      await modelManager.stopServer();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("llama-server-status", async () => {
    try {
      const modelManager = require("../../modelManagerBridge").default;
      return modelManager.getServerStatus();
    } catch (error) {
      return { available: false, running: false, error: error.message };
    }
  });
}

module.exports = { registerLlamaServerHandlers };

