import logger from "../../utils/logger";

export type ReasoningApiKeyProvider = "openai" | "anthropic" | "gemini" | "groq" | "custom";

export async function getReasoningApiKey({
  provider,
  apiKeyCache,
  electronAPI,
  localStorage,
}: {
  provider: ReasoningApiKeyProvider;
  apiKeyCache: {
    get: (key: string) => string | undefined;
    set: (key: string, value: string) => void;
    size?: number;
  };
  electronAPI?: any;
  localStorage?: Storage;
}): Promise<string> {
  void localStorage;
  if (provider === "custom") {
    const status = await electronAPI?.getApiKeyStatus?.();
    return status?.customReasoning ? "configured-in-main" : "";
  }

  let apiKey = apiKeyCache.get(provider);

  logger.logReasoning(`${provider.toUpperCase()}_KEY_RETRIEVAL`, {
    provider,
    fromCache: Boolean(apiKey),
    cacheSize: apiKeyCache.size || 0,
  });

  if (!apiKey) {
    try {
      const status = await electronAPI?.getApiKeyStatus?.();
      const configured = Boolean(status?.[provider]);
      apiKey = configured ? "configured-in-main" : undefined;

      logger.logReasoning(`${provider.toUpperCase()}_KEY_FETCHED`, {
        provider,
        hasKey: Boolean(apiKey),
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
