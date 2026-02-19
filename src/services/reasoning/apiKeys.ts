import logger from "../../utils/logger";

export type ReasoningApiKeyProvider = "openai" | "anthropic" | "gemini" | "groq" | "custom";

export async function getReasoningApiKey({
  provider,
  apiKeyCache,
  electronAPI,
  localStorage,
}: {
  provider: ReasoningApiKeyProvider;
  apiKeyCache: { get: (key: string) => string | undefined; set: (key: string, value: string) => void; size?: number };
  electronAPI?: any;
  localStorage?: Storage;
}): Promise<string> {
  if (provider === "custom") {
    let customKey = "";
    try {
      customKey = (await electronAPI?.getCustomReasoningKey?.()) || "";
    } catch (err) {
      logger.logReasoning("CUSTOM_KEY_IPC_FALLBACK", { error: (err as Error)?.message });
    }
    if (!customKey || !customKey.trim()) {
      customKey = localStorage?.getItem("customReasoningApiKey") || "";
    }
    const trimmedKey = customKey.trim();

    logger.logReasoning("CUSTOM_KEY_RETRIEVAL", {
      provider,
      hasKey: Boolean(trimmedKey),
      keyLength: trimmedKey.length,
      keyPreview: trimmedKey ? `${trimmedKey.substring(0, 8)}...` : "none",
    });

    return trimmedKey;
  }

  let apiKey = apiKeyCache.get(provider);

  logger.logReasoning(`${provider.toUpperCase()}_KEY_RETRIEVAL`, {
    provider,
    fromCache: Boolean(apiKey),
    cacheSize: apiKeyCache.size || 0,
  });

  if (!apiKey) {
    try {
      const keyGetters: Record<string, () => Promise<string>> = {
        openai: () => electronAPI.getOpenAIKey(),
        anthropic: () => electronAPI.getAnthropicKey(),
        gemini: () => electronAPI.getGeminiKey(),
        groq: () => electronAPI.getGroqKey(),
      };
      apiKey = (await keyGetters[provider]()) ?? undefined;

      logger.logReasoning(`${provider.toUpperCase()}_KEY_FETCHED`, {
        provider,
        hasKey: Boolean(apiKey),
        keyLength: apiKey?.length || 0,
        keyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : "none",
      });

      if (apiKey) {
        apiKeyCache.set(provider, apiKey);
      }
    } catch (error) {
      logger.logReasoning(`${provider.toUpperCase()}_KEY_FETCH_ERROR`, {
        provider,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
    }
  }

  if (!apiKey) {
    const errorMsg = `${provider.charAt(0).toUpperCase() + provider.slice(1)} API key not configured`;
    logger.logReasoning(`${provider.toUpperCase()}_KEY_MISSING`, {
      provider,
      error: errorMsg,
    });
    throw new Error(errorMsg);
  }

  return apiKey;
}

