const debugLogger = require("../../debugLogger");

function registerDictationKeyHandlers({ ipcMain }, { environmentManager, syncStartupEnv }) {
  ipcMain.handle("get-dictation-key", async () => {
    return environmentManager.getDictationKey();
  });

  ipcMain.handle("save-dictation-key", async (_event, key) => {
    return environmentManager.saveDictationKey(key);
  });

  ipcMain.handle("get-dictation-key-clipboard", async () => {
    return environmentManager.getClipboardDictationKey();
  });

  ipcMain.handle("save-dictation-key-clipboard", async (_event, key) => {
    return environmentManager.saveClipboardDictationKey(key);
  });

  ipcMain.handle("get-activation-mode", async () => {
    return environmentManager.getActivationMode();
  });

  ipcMain.handle("save-activation-mode", async (_event, mode) => {
    return environmentManager.saveActivationMode(mode);
  });

  ipcMain.handle("save-anthropic-key", async (_event, key) => {
    return environmentManager.saveAnthropicKey(key);
  });

  ipcMain.handle("save-all-keys-to-env", async () => {
    return environmentManager.saveAllKeysToEnvFile();
  });

  ipcMain.handle("sync-startup-preferences", async (_event, prefs) => {
    const setVars = {};
    const clearVars = [];

    if (prefs.useLocalWhisper && prefs.model) {
      // Local mode with model selected - set provider and model for pre-warming
      setVars.LOCAL_TRANSCRIPTION_PROVIDER = prefs.localTranscriptionProvider;
      if (prefs.localTranscriptionProvider === "nvidia") {
        setVars.PARAKEET_MODEL = prefs.model;
        clearVars.push("LOCAL_WHISPER_MODEL");
      } else {
        setVars.LOCAL_WHISPER_MODEL = prefs.model;
        clearVars.push("PARAKEET_MODEL");
      }
    } else if (prefs.useLocalWhisper) {
      // Local mode enabled but no model selected - clear pre-warming vars
      clearVars.push("LOCAL_TRANSCRIPTION_PROVIDER", "PARAKEET_MODEL", "LOCAL_WHISPER_MODEL");
    } else {
      // Cloud mode - clear all local transcription vars
      clearVars.push("LOCAL_TRANSCRIPTION_PROVIDER", "PARAKEET_MODEL", "LOCAL_WHISPER_MODEL");
    }

    if (prefs.reasoningProvider === "local" && prefs.reasoningModel) {
      setVars.REASONING_PROVIDER = "local";
      setVars.LOCAL_REASONING_MODEL = prefs.reasoningModel;
    } else if (prefs.reasoningProvider && prefs.reasoningProvider !== "local") {
      clearVars.push("REASONING_PROVIDER", "LOCAL_REASONING_MODEL");
    }

    syncStartupEnv(setVars, clearVars);
  });

  ipcMain.handle("process-local-reasoning", async (_event, text, modelId, _agentName, config) => {
    try {
      const LocalReasoningService = require("../../../services/localReasoningBridge").default;
      const result = await LocalReasoningService.processText(text, modelId, config);
      return { success: true, text: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "process-anthropic-reasoning",
    async (_event, text, modelId, _agentName, config) => {
      try {
        const apiKey = environmentManager.getAnthropicKey();

        if (!apiKey) {
          throw new Error("Anthropic API key not configured");
        }

        const systemPrompt = config?.systemPrompt || "";
        const userPrompt = text;

        if (!modelId) {
          throw new Error("No model specified for Anthropic API call");
        }

        const requestBody = {
          model: modelId,
          messages: [{ role: "user", content: userPrompt }],
          system: systemPrompt,
          max_tokens: config?.maxTokens || Math.max(100, Math.min(text.length * 2, 4096)),
          temperature: config?.temperature || 0.3,
        };

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorData = { error: response.statusText };
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText || response.statusText };
          }
          throw new Error(
            errorData.error?.message || errorData.error || `Anthropic API error: ${response.status}`
          );
        }

        const data = await response.json();
        return { success: true, text: data.content[0].text.trim() };
      } catch (error) {
        debugLogger.error("Anthropic reasoning error:", error);
        return { success: false, error: error.message };
      }
    }
  );

  ipcMain.handle("check-local-reasoning-available", async () => {
    try {
      const LocalReasoningService = require("../../../services/localReasoningBridge").default;
      return await LocalReasoningService.isAvailable();
    } catch {
      return false;
    }
  });
}

module.exports = { registerDictationKeyHandlers };

