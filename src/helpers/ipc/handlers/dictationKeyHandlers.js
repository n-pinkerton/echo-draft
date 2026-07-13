const debugLogger = require("../../debugLogger");

function registerDictationKeyHandlers(
  { ipcMain },
  { environmentManager, syncStartupEnv, cancelableRequests }
) {
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

  ipcMain.handle(
    "process-local-reasoning",
    async (event, text, modelId, _agentName, config, requestId) => {
      let requestScope;
      try {
        requestScope = cancelableRequests.createScope(event, requestId);
        if (requestScope.signal.aborted) {
          throw Object.assign(new Error("Request cancelled"), { name: "AbortError" });
        }
        const LocalReasoningService = require("../../../services/localReasoningBridge").default;
        const result = await LocalReasoningService.processText(text, modelId, {
          ...(config || {}),
          signal: requestScope.signal,
        });
        return { success: true, text: result };
      } catch (error) {
        if (error?.name === "AbortError" || requestScope?.signal.aborted) {
          return { success: false, error: "Request cancelled", code: "REQUEST_CANCELLED" };
        }
        return {
          success: false,
          error: "Local reasoning did not complete.",
          code: error?.code || "LOCAL_REASONING_ERROR",
        };
      } finally {
        requestScope?.finish();
      }
    }
  );

  ipcMain.handle(
    "process-anthropic-reasoning",
    async (event, text, modelId, _agentName, config, requestId) => {
      let requestScope;
      try {
        requestScope = cancelableRequests.createScope(event, requestId);
        if (requestScope.signal.aborted) {
          throw Object.assign(new Error("Request cancelled"), { name: "AbortError" });
        }
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
          signal: requestScope.signal,
        });

        if (!response.ok) {
          throw new Error(`Anthropic reasoning failed (HTTP ${response.status}).`);
        }

        const data = await response.json();
        return { success: true, text: data.content[0].text.trim() };
      } catch (error) {
        if (error?.name === "AbortError" || requestScope?.signal.aborted) {
          debugLogger.info("Anthropic reasoning cancelled", {}, "reasoning");
          return { success: false, error: "Request cancelled", code: "REQUEST_CANCELLED" };
        }
        debugLogger.error(
          "Anthropic reasoning error",
          { errorCategory: error?.code || error?.name || "unknown" },
          "reasoning"
        );
        return {
          success: false,
          error: "Anthropic reasoning did not complete.",
          code: error?.code || "ANTHROPIC_REASONING_ERROR",
        };
      } finally {
        requestScope?.finish();
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
