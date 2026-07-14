const debugLogger = require("../../debugLogger");
const { rejectRedirectResponse } = require("./cloudApiHandlers");
const { requireTrustedRenderer } = require("../trustedRenderer");
const modelRegistryData = require("../../../models/modelRegistryData.json");
const {
  CLEANUP_PROMPT_MODES,
  buildCleanupSystemPrompt,
  validateWrappedCleanupInput,
} = require("../../../config/cleanupPolicy.cjs");
const { requireLanguageCode } = require("../../../utils/languagePolicy.cjs");
const {
  MAX_USER_DICTIONARY_ENTRIES,
  sanitizeLexicalDictionaryEntries,
} = require("../../../utils/dictionaryLexicon.cjs");
const {
  awaitWithSignal,
  createHardDeadline,
  readResponseTextBounded,
} = require("./providerRequestHandlers");

const ANTHROPIC_CLEANUP_TIMEOUT_MS = 200_000;
const ANTHROPIC_MODELS = new Set(
  (modelRegistryData.cloudProviders || [])
    .find((provider) => provider.id === "anthropic")
    ?.models?.map((model) => model.id) || []
);
const ANTHROPIC_CLEANUP_SYSTEM_PROMPT = buildCleanupSystemPrompt("anthropic");

const validateCleanupDictionaryEntries = (value, label) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_USER_DICTIONARY_ENTRIES) {
    throw new Error(`${label} cleanup dictionary is unsupported`);
  }
  const safeEntries = sanitizeLexicalDictionaryEntries(value, {
    maxEntries: MAX_USER_DICTIONARY_ENTRIES,
    maxEntryLength: 80,
    maxWords: 1,
  });
  if (safeEntries.length !== value.length) {
    throw new Error(`${label} cleanup dictionary contains unsupported entries`);
  }
  return safeEntries;
};

const validateAnthropicCleanupInput = (text, modelId, config = {}) => {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Invalid Anthropic cleanup options");
  }
  const allowed = new Set([
    "maxTokens",
    "temperature",
    "contextSize",
    "cleanupPromptMode",
    "reasoningEffort",
    "language",
    "dictionaryEntries",
  ]);
  if (Object.keys(config).some((key) => !allowed.has(key))) {
    throw new Error("Anthropic cleanup options contain unsupported fields");
  }
  const model = typeof modelId === "string" ? modelId.trim() : "";
  if (!ANTHROPIC_MODELS.has(model)) throw new Error("Unsupported Anthropic cleanup model");
  const wrapped = validateWrappedCleanupInput(text, model);
  const requestedTokens = config.maxTokens;
  const maxTokens =
    requestedTokens === undefined
      ? Math.max(2048, Math.min(16_384, Math.ceil(wrapped.inputLength / 2) + 512))
      : Number(requestedTokens);
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 64 || maxTokens > 16_384) {
    throw new Error("Anthropic cleanup output budget is unsupported");
  }
  const temperature = config.temperature === undefined ? 0.3 : Number(config.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1.5) {
    throw new Error("Anthropic cleanup temperature is unsupported");
  }
  const mode = config.cleanupPromptMode || "standard";
  if (!CLEANUP_PROMPT_MODES.has(mode)) {
    throw new Error("Anthropic cleanup mode is unsupported");
  }
  const language = requireLanguageCode(config.language, { allowAuto: true }, "cleanup language");
  const dictionaryEntries = validateCleanupDictionaryEntries(config.dictionaryEntries, "Anthropic");
  const systemPrompt = buildCleanupSystemPrompt(model, mode, language, dictionaryEntries);
  return { model, maxTokens, temperature, systemPrompt, ...wrapped };
};

function registerDictationKeyHandlers(
  { ipcMain },
  {
    environmentManager,
    syncStartupEnv,
    cancelableRequests,
    windowManager,
    localReasoningService = null,
  }
) {
  const requireControlPanel = (event) =>
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
  const requireProcessingRenderer = (event) => requireTrustedRenderer(event, windowManager);
  const normalizeStartupToken = (value, label, maxLength = 200) => {
    const token = typeof value === "string" ? value.trim() : "";
    if (!token || token.length > maxLength || !/^[A-Za-z0-9._:/-]+$/.test(token)) {
      throw new Error(`Invalid ${label}`);
    }
    return token;
  };
  const validateReasoningInput = (text, modelId, config = {}) => {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("Invalid local cleanup options");
    }
    const allowed = new Set([
      "maxTokens",
      "temperature",
      "contextSize",
      "cleanupPromptMode",
      "reasoningEffort",
      "language",
      "dictionaryEntries",
    ]);
    if (Object.keys(config).some((key) => !allowed.has(key))) {
      throw new Error("Local cleanup options contain unsupported fields");
    }
    const model = typeof modelId === "string" ? modelId.trim() : "";
    if (model.length < 1 || model.length > 200 || !/^[A-Za-z0-9._:/-]+$/.test(model)) {
      throw new Error("Invalid reasoning model");
    }
    const wrapped = validateWrappedCleanupInput(text, model);
    const mode = config.cleanupPromptMode || "standard";
    if (!CLEANUP_PROMPT_MODES.has(mode)) throw new Error("Local cleanup mode is unsupported");
    const language = requireLanguageCode(config.language, { allowAuto: true }, "cleanup language");
    const dictionaryEntries = validateCleanupDictionaryEntries(config.dictionaryEntries, "Local");
    if (
      config.reasoningEffort !== undefined &&
      !new Set(["none", "low", "medium"]).has(config.reasoningEffort)
    ) {
      throw new Error("Local cleanup reasoning effort is unsupported");
    }
    const maxTokens = Number(config?.maxTokens);
    const temperature = Number(config?.temperature);
    const contextSize = Number(config?.contextSize);
    return {
      userPrompt: wrapped.userPrompt,
      ...(Number.isFinite(maxTokens)
        ? { maxTokens: Math.max(64, Math.min(32_768, Math.round(maxTokens))) }
        : {}),
      ...(Number.isFinite(temperature)
        ? { temperature: Math.max(0, Math.min(2, temperature)) }
        : {}),
      ...(Number.isFinite(contextSize)
        ? { contextSize: Math.max(512, Math.min(131_072, Math.round(contextSize))) }
        : {}),
      systemPrompt: buildCleanupSystemPrompt(model, mode, language, dictionaryEntries),
    };
  };

  ipcMain.handle("get-dictation-key", async (event) => {
    requireControlPanel(event);
    return environmentManager.getDictationKey();
  });

  ipcMain.handle("save-dictation-key", async (event, key) => {
    requireControlPanel(event);
    return environmentManager.saveDictationKey(key);
  });

  ipcMain.handle("get-dictation-key-clipboard", async (event) => {
    requireControlPanel(event);
    return environmentManager.getClipboardDictationKey();
  });

  ipcMain.handle("save-dictation-key-clipboard", async (event, key) => {
    requireControlPanel(event);
    return environmentManager.saveClipboardDictationKey(key);
  });

  ipcMain.handle("get-activation-mode", async (event) => {
    requireControlPanel(event);
    return environmentManager.getActivationMode();
  });

  ipcMain.handle("save-activation-mode", async (event, mode) => {
    requireControlPanel(event);
    return environmentManager.saveActivationMode(mode);
  });

  ipcMain.handle("save-anthropic-key", async (event, key) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    return environmentManager.saveAnthropicKey(key);
  });

  ipcMain.handle("save-all-keys-to-env", async (event) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    return environmentManager.saveAllKeysToEnvFile();
  });

  ipcMain.handle("sync-startup-preferences", async (event, prefs) => {
    requireControlPanel(event);
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) {
      throw new Error("Invalid startup preferences");
    }
    const setVars = {};
    const clearVars = [];
    const useLocalWhisper = prefs.useLocalWhisper === true;
    const localProvider = prefs.localTranscriptionProvider === "nvidia" ? "nvidia" : "whisper";
    const transcriptionModel = prefs.model
      ? normalizeStartupToken(prefs.model, "transcription model")
      : "";
    const reasoningProvider = prefs.reasoningProvider
      ? normalizeStartupToken(prefs.reasoningProvider, "reasoning provider", 64)
      : "";
    const reasoningModel = prefs.reasoningModel
      ? normalizeStartupToken(prefs.reasoningModel, "reasoning model")
      : "";

    if (useLocalWhisper && transcriptionModel) {
      // Local mode with model selected - set provider and model for pre-warming
      setVars.LOCAL_TRANSCRIPTION_PROVIDER = localProvider;
      if (localProvider === "nvidia") {
        setVars.PARAKEET_MODEL = transcriptionModel;
        clearVars.push("LOCAL_WHISPER_MODEL");
      } else {
        setVars.LOCAL_WHISPER_MODEL = transcriptionModel;
        clearVars.push("PARAKEET_MODEL");
      }
    } else if (useLocalWhisper) {
      // Local mode enabled but no model selected - clear pre-warming vars
      clearVars.push("LOCAL_TRANSCRIPTION_PROVIDER", "PARAKEET_MODEL", "LOCAL_WHISPER_MODEL");
    } else {
      // Cloud mode - clear all local transcription vars
      clearVars.push("LOCAL_TRANSCRIPTION_PROVIDER", "PARAKEET_MODEL", "LOCAL_WHISPER_MODEL");
    }

    if (reasoningProvider === "local" && reasoningModel) {
      setVars.REASONING_PROVIDER = "local";
      setVars.LOCAL_REASONING_MODEL = reasoningModel;
    } else if (reasoningProvider && reasoningProvider !== "local") {
      clearVars.push("REASONING_PROVIDER", "LOCAL_REASONING_MODEL");
    }

    syncStartupEnv(setVars, clearVars);
  });

  ipcMain.handle(
    "process-local-reasoning",
    async (event, text, modelId, _agentName, config, requestId) => {
      requireProcessingRenderer(event);
      let requestScope;
      try {
        const { userPrompt, ...safeConfig } = validateReasoningInput(text, modelId, config);
        requestScope = cancelableRequests.createScope(event, requestId);
        if (requestScope.signal.aborted) {
          throw Object.assign(new Error("Request cancelled"), { name: "AbortError" });
        }
        const service =
          localReasoningService || require("../../../services/localReasoningBridge").default;
        const result = await service.processText(userPrompt, modelId, {
          ...safeConfig,
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
      requireProcessingRenderer(event);
      let requestScope;
      let deadline;
      try {
        const safeConfig = validateAnthropicCleanupInput(text, modelId, config);
        requestScope = cancelableRequests.createScope(event, requestId);
        deadline = createHardDeadline(requestScope.signal, ANTHROPIC_CLEANUP_TIMEOUT_MS);
        if (requestScope.signal.aborted) {
          throw Object.assign(new Error("Request cancelled"), { name: "AbortError" });
        }
        const apiKey = environmentManager.getAnthropicKey();

        if (!apiKey) {
          throw new Error("Anthropic API key not configured");
        }

        const requestBody = {
          model: safeConfig.model,
          messages: [{ role: "user", content: safeConfig.userPrompt }],
          system: safeConfig.systemPrompt,
          max_tokens: safeConfig.maxTokens,
          temperature: safeConfig.temperature,
        };

        const response = await awaitWithSignal(
          fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            redirect: "manual",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(requestBody),
            signal: deadline.signal,
          }),
          deadline.signal
        );
        rejectRedirectResponse(response, "Anthropic reasoning");

        if (!response.ok) {
          throw new Error(`Anthropic reasoning failed (HTTP ${response.status}).`);
        }

        const responseText = await readResponseTextBounded(
          response,
          8 * 1024 * 1024,
          null,
          deadline.signal
        );
        let data;
        try {
          data = JSON.parse(responseText);
        } catch {
          throw new Error("Anthropic reasoning returned invalid JSON");
        }
        const content = Array.isArray(data?.content) ? data.content : [];
        const textBlock = content.find(
          (block) =>
            block &&
            typeof block === "object" &&
            (block.type === undefined || block.type === "text") &&
            typeof block.text === "string"
        );
        const cleanedText = textBlock?.text?.trim() || "";
        if (!cleanedText || cleanedText.length > 1_000_000) {
          throw new Error("Anthropic reasoning returned an invalid response");
        }
        return { success: true, text: cleanedText };
      } catch (error) {
        if (requestScope?.signal.aborted || error?.code === "REQUEST_CANCELLED") {
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
        deadline?.finish();
        requestScope?.finish();
      }
    }
  );

  ipcMain.handle("check-local-reasoning-available", async (event) => {
    requireTrustedRenderer(event, windowManager);
    try {
      const service =
        localReasoningService || require("../../../services/localReasoningBridge").default;
      return await service.isAvailable();
    } catch {
      return false;
    }
  });
}

module.exports = {
  ANTHROPIC_CLEANUP_SYSTEM_PROMPT,
  registerDictationKeyHandlers,
  validateAnthropicCleanupInput,
};
