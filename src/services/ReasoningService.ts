import { getModelProvider } from "../models/ModelRegistry";
import { BaseReasoningService, ReasoningConfig } from "./BaseReasoningService";
import { SecureCache } from "../utils/SecureCache";
import { API_ENDPOINTS, buildApiUrl } from "../config/constants";
import { LEGACY_PROMPTS, stripUntrustedTranscriptionWrapper } from "../config/prompts";
import logger from "../utils/logger";
import { processWithOpenAiProvider } from "./reasoning/providers/openaiProvider";
import { getReasoningApiKey } from "./reasoning/apiKeys";
import { callChatCompletionsApi } from "./reasoning/providers/chatCompletionsApi";
import { processWithGeminiProvider } from "./reasoning/providers/geminiProvider";
import { processWithIpcProvider } from "./reasoning/providers/ipcProvider";
import { processWithEchoDraftProvider } from "./reasoning/providers/echoDraftProvider";
import { OpenAiEndpointResolver } from "./reasoning/openaiEndpoints";
import { checkReasoningAvailability } from "./reasoning/availability";

/**
 * @deprecated Use UNIFIED_SYSTEM_PROMPT from ../config/prompts instead
 * Kept for backwards compatibility with PromptStudio UI
 */
export const DEFAULT_PROMPTS = LEGACY_PROMPTS;

class ReasoningService extends BaseReasoningService {
  private apiKeyCache: SecureCache<string>;
  private openAiEndpointResolver: OpenAiEndpointResolver;
  private cacheCleanupStop: (() => void) | undefined;

  constructor() {
    super();
    this.apiKeyCache = new SecureCache();
    this.cacheCleanupStop = this.apiKeyCache.startAutoCleanup();
    this.openAiEndpointResolver = new OpenAiEndpointResolver();

    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => this.destroy());
    }
  }

  private async getApiKey(
    provider: "openai" | "anthropic" | "gemini" | "groq" | "custom"
  ): Promise<string> {
    return await getReasoningApiKey({
      provider,
      apiKeyCache: this.apiKeyCache,
      electronAPI: window.electronAPI,
      localStorage: window.localStorage,
    });
  }

  async processText(
    text: string,
    model: string = "",
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    const trimmedModel = model?.trim?.() || "";
    if (!trimmedModel) {
      throw new Error("No reasoning model selected");
    }
    const provider = getModelProvider(trimmedModel);

    logger.logReasoning("PROVIDER_SELECTION", {
      model: trimmedModel,
      provider,
      agentName,
      hasConfig: Object.keys(config).length > 0,
      textLength: text.length,
      timestamp: new Date().toISOString(),
    });

    try {
      let result: string;
      const startTime = Date.now();

      logger.logReasoning("ROUTING_TO_PROVIDER", {
        provider,
        model,
      });

      switch (provider) {
        case "openai":
          result = await this.processWithOpenAI(text, trimmedModel, agentName, config);
          break;
        case "anthropic":
          result = await this.processWithAnthropic(text, trimmedModel, agentName, config);
          break;
        case "local":
          result = await this.processWithLocal(text, trimmedModel, agentName, config);
          break;
        case "gemini":
          result = await this.processWithGemini(text, trimmedModel, agentName, config);
          break;
        case "groq":
          result = await this.processWithGroq(text, model, agentName, config);
          break;
        case "openwhispr":
          result = await this.processWithEchoDraft(text, model, agentName, config);
          break;
        default:
          throw new Error(`Unsupported reasoning provider: ${provider}`);
      }

      result = stripUntrustedTranscriptionWrapper(result);

      const processingTime = Date.now() - startTime;

      logger.logReasoning("PROVIDER_SUCCESS", {
        provider,
        model,
        processingTimeMs: processingTime,
        resultLength: result.length,
        resultPreview: result.substring(0, 100) + (result.length > 100 ? "..." : ""),
      });

      return result;
    } catch (error) {
      logger.logReasoning("PROVIDER_ERROR", {
        provider,
        model,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      throw error;
    }
  }

  private async processWithOpenAI(
    text: string,
    model: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    const reasoningProvider = window.localStorage?.getItem("reasoningProvider") || "";
    const isCustomProvider = reasoningProvider === "custom";

    if (this.isProcessing) {
      throw new Error("Already processing a request");
    }

    const apiKey = await this.getApiKey(isCustomProvider ? "custom" : "openai");

    this.isProcessing = true;

    try {
      const storage = typeof window !== "undefined" ? window.localStorage : undefined;
      const openAiBase = this.openAiEndpointResolver.getConfiguredBase(storage);
      const endpointCandidates = this.openAiEndpointResolver.getEndpointCandidates(openAiBase, storage);
      return await processWithOpenAiProvider({
        text,
        model,
        agentName,
        config,
        apiKey,
        isCustomProvider,
        openAiBase,
        endpointCandidates,
        getSystemPrompt: (value) => this.getSystemPrompt(value),
        calculateMaxTokens: (inputLength, minTokens, maxTokens, multiplier) =>
          this.calculateMaxTokens(inputLength, minTokens, maxTokens, multiplier),
        getStoredOpenAiPreference: (base) => this.openAiEndpointResolver.getStoredPreference(base, storage),
        rememberOpenAiPreference: (base, preference) =>
          this.openAiEndpointResolver.rememberPreference(base, preference, storage),
      });
    } catch (error) {
      logger.logReasoning("OPENAI_ERROR", {
        model,
        error: (error as Error).message,
        errorType: (error as Error).name,
      });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  private async processWithAnthropic(
    text: string,
    model: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    if (typeof window === "undefined" || !window.electronAPI) {
      logger.logReasoning("ANTHROPIC_UNAVAILABLE", {
        reason: "Not in Electron environment",
      });
      throw new Error("Anthropic reasoning is not available in this environment");
    }

    return await processWithIpcProvider({
      providerName: "anthropic",
      text,
      model,
      agentName,
      config,
      getSystemPrompt: (value) => this.getSystemPrompt(value),
      ipcCall: (userPrompt, modelName, agent, options) =>
        window.electronAPI.processAnthropicReasoning(userPrompt, modelName, agent, options),
    });
  }

  private async processWithLocal(
    text: string,
    model: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    if (typeof window === "undefined" || !window.electronAPI) {
      logger.logReasoning("LOCAL_UNAVAILABLE", {
        reason: "Not in Electron environment",
      });
      throw new Error("Local reasoning is not available in this environment");
    }

    return await processWithIpcProvider({
      providerName: "local",
      text,
      model,
      agentName,
      config,
      getSystemPrompt: (value) => this.getSystemPrompt(value),
      ipcCall: (userPrompt, modelName, agent, options) =>
        window.electronAPI.processLocalReasoning(userPrompt, modelName, agent, options),
    });
  }

  private async processWithGemini(
    text: string,
    model: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    if (this.isProcessing) {
      throw new Error("Already processing a request");
    }

    const apiKey = await this.getApiKey("gemini");

    this.isProcessing = true;

    try {
      return await processWithGeminiProvider({
        text,
        model,
        agentName,
        config,
        apiKey,
        getSystemPrompt: (value) => this.getSystemPrompt(value),
        calculateMaxTokens: (inputLength, minTokens, maxTokens, multiplier) =>
          this.calculateMaxTokens(inputLength, minTokens, maxTokens, multiplier),
      });
    } catch (error) {
      logger.logReasoning("GEMINI_ERROR", {
        model,
        error: (error as Error).message,
        errorType: (error as Error).name,
      });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  private async processWithGroq(
    text: string,
    model: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    logger.logReasoning("GROQ_START", { model, agentName });

    if (this.isProcessing) {
      throw new Error("Already processing a request");
    }

      const apiKey = await this.getApiKey("groq");
      this.isProcessing = true;

      try {
        const endpoint = buildApiUrl(API_ENDPOINTS.GROQ_BASE, "/chat/completions");
        return await callChatCompletionsApi({
          endpoint,
          apiKey,
          model,
          text,
          agentName,
          config,
          providerName: "Groq",
          getSystemPrompt: (value) => this.getSystemPrompt(value),
          calculateMaxTokens: (inputLength, minTokens, maxTokens, multiplier) =>
            this.calculateMaxTokens(inputLength, minTokens, maxTokens, multiplier),
        });
      } catch (error) {
        logger.logReasoning("GROQ_ERROR", {
          model,
          error: (error as Error).message,
        errorType: (error as Error).name,
      });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  private async processWithEchoDraft(
    text: string,
    model: string,
    agentName: string | null = null,
    config: ReasoningConfig = {}
  ): Promise<string> {
    if (this.isProcessing) {
      throw new Error("Already processing a request");
    }

    this.isProcessing = true;

    try {
      if (typeof window === "undefined" || !(window as any).electronAPI?.cloudReason) {
        throw new Error("EchoDraft cloud reasoning is not available in this environment");
      }

      return await processWithEchoDraftProvider({
        text,
        model,
        agentName,
        _config: config,
        getCustomDictionary: () => this.getCustomDictionary(),
        getPreferredLanguage: () => this.getPreferredLanguage(),
        cloudReason: (input, payload) => (window as any).electronAPI.cloudReason(input, payload),
      });
    } catch (error) {
      logger.logReasoning("OPENWHISPR_ERROR", {
        model,
        error: (error as Error).message,
      });
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  async isAvailable(): Promise<boolean> {
    return await checkReasoningAvailability(window.electronAPI);
  }

  clearApiKeyCache(
    provider?: "openai" | "anthropic" | "gemini" | "groq" | "mistral" | "custom"
  ): void {
    if (provider) {
      if (provider !== "custom") {
        this.apiKeyCache.delete(provider);
      }
      logger.logReasoning("API_KEY_CACHE_CLEARED", { provider });
    } else {
      this.apiKeyCache.clear();
      logger.logReasoning("API_KEY_CACHE_CLEARED", { provider: "all" });
    }
  }

  destroy(): void {
    if (this.cacheCleanupStop) {
      this.cacheCleanupStop();
    }
  }
}

export default new ReasoningService();
