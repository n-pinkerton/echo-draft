import logger from "../../utils/logger";

type ElectronAPI = {
  getApiKeyStatus?: () => Promise<{
    openai?: boolean;
    anthropic?: boolean;
    gemini?: boolean;
    groq?: boolean;
  }>;
  checkLocalReasoningAvailable?: () => Promise<boolean | undefined>;
};

export async function checkReasoningAvailability(
  electronAPI?: ElectronAPI,
  provider: string = "auto"
): Promise<boolean> {
  try {
    const keyStatus = await electronAPI?.getApiKeyStatus?.();
    const localAvailable = await electronAPI?.checkLocalReasoningAvailable?.();

    logger.logReasoning("API_KEY_CHECK", {
      hasOpenAI: Boolean(keyStatus?.openai),
      hasAnthropic: Boolean(keyStatus?.anthropic),
      hasGemini: Boolean(keyStatus?.gemini),
      hasGroq: Boolean(keyStatus?.groq),
      hasLocal: !!localAvailable,
    });

    switch (provider) {
      case "openai":
        return Boolean(keyStatus?.openai);
      case "anthropic":
        return Boolean(keyStatus?.anthropic);
      case "gemini":
        return Boolean(keyStatus?.gemini);
      case "groq":
        return Boolean(keyStatus?.groq);
      case "local":
        return Boolean(localAvailable);
      case "custom":
        // Custom OpenAI-compatible endpoints may intentionally allow unauthenticated local access.
        return true;
      default:
        return Boolean(
          keyStatus?.openai ||
          keyStatus?.anthropic ||
          keyStatus?.gemini ||
          keyStatus?.groq ||
          localAvailable
        );
    }
  } catch (error) {
    logger.logReasoning("API_KEY_CHECK_ERROR", {
      error: (error as Error).message,
      stack: (error as Error).stack,
      name: (error as Error).name,
    });
    return false;
  }
}
