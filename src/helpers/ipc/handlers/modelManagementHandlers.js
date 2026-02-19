const debugLogger = require("../../debugLogger");

const MISTRAL_TRANSCRIPTION_URL = "https://api.mistral.ai/v1/audio/transcriptions";

function registerModelManagementHandlers({ ipcMain }, { environmentManager }) {
  ipcMain.handle("model-get-all", async () => {
    try {
      debugLogger.debug("model-get-all called", undefined, "ipc");
      const modelManager = require("../../modelManagerBridge").default;
      const models = await modelManager.getModelsWithStatus();
      debugLogger.debug("Returning models", { count: models.length }, "ipc");
      return models;
    } catch (error) {
      debugLogger.error("Error in model-get-all:", error);
      throw error;
    }
  });

  ipcMain.handle("model-check", async (_event, modelId) => {
    const modelManager = require("../../modelManagerBridge").default;
    return modelManager.isModelDownloaded(modelId);
  });

  ipcMain.handle("model-download", async (event, modelId) => {
    try {
      const modelManager = require("../../modelManagerBridge").default;
      const result = await modelManager.downloadModel(modelId, (progress, downloadedSize, totalSize) => {
        event.sender.send("model-download-progress", {
          modelId,
          progress,
          downloadedSize,
          totalSize,
        });
      });
      return { success: true, path: result };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details,
      };
    }
  });

  ipcMain.handle("model-delete", async (_event, modelId) => {
    try {
      const modelManager = require("../../modelManagerBridge").default;
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

  ipcMain.handle("model-delete-all", async () => {
    try {
      const modelManager = require("../../modelManagerBridge").default;
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

  ipcMain.handle("model-cancel-download", async (_event, modelId) => {
    try {
      const modelManager = require("../../modelManagerBridge").default;
      const cancelled = modelManager.cancelDownload(modelId);
      return { success: cancelled };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  });

  ipcMain.handle("model-check-runtime", async () => {
    try {
      const modelManager = require("../../modelManagerBridge").default;
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

  ipcMain.handle("get-anthropic-key", async () => {
    return environmentManager.getAnthropicKey();
  });

  ipcMain.handle("get-gemini-key", async () => {
    return environmentManager.getGeminiKey();
  });

  ipcMain.handle("save-gemini-key", async (_event, key) => {
    return environmentManager.saveGeminiKey(key);
  });

  ipcMain.handle("get-groq-key", async () => {
    return environmentManager.getGroqKey();
  });

  ipcMain.handle("save-groq-key", async (_event, key) => {
    return environmentManager.saveGroqKey(key);
  });

  ipcMain.handle("get-mistral-key", async () => {
    return environmentManager.getMistralKey();
  });

  ipcMain.handle("save-mistral-key", async (_event, key) => {
    return environmentManager.saveMistralKey(key);
  });

  // Proxy Mistral transcription through main process to avoid CORS
  ipcMain.handle(
    "proxy-mistral-transcription",
    async (_event, { audioBuffer, model, language, contextBias }) => {
      const apiKey = environmentManager.getMistralKey();
      if (!apiKey) {
        throw new Error("Mistral API key not configured");
      }

      const formData = new FormData();
      const audioBlob = new Blob([Buffer.from(audioBuffer)], { type: "audio/webm" });
      formData.append("file", audioBlob, "audio.webm");
      formData.append("model", model || "voxtral-mini-latest");
      if (language && language !== "auto") {
        formData.append("language", language);
      }
      if (contextBias && contextBias.length > 0) {
        for (const token of contextBias) {
          formData.append("context_bias", token);
        }
      }

      const response = await fetch(MISTRAL_TRANSCRIPTION_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mistral API Error: ${response.status} ${errorText}`);
      }

      return await response.json();
    }
  );

  ipcMain.handle("get-custom-transcription-key", async () => {
    return environmentManager.getCustomTranscriptionKey();
  });

  ipcMain.handle("save-custom-transcription-key", async (_event, key) => {
    return environmentManager.saveCustomTranscriptionKey(key);
  });

  ipcMain.handle("get-custom-reasoning-key", async () => {
    return environmentManager.getCustomReasoningKey();
  });

  ipcMain.handle("save-custom-reasoning-key", async (_event, key) => {
    return environmentManager.saveCustomReasoningKey(key);
  });
}

module.exports = { registerModelManagementHandlers };

