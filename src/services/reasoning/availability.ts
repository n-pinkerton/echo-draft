import logger from "../../utils/logger";

type ElectronAPI = {
  getOpenAIKey?: () => Promise<string | null | undefined>;
  getAnthropicKey?: () => Promise<string | null | undefined>;
  getGeminiKey?: () => Promise<string | null | undefined>;
  getGroqKey?: () => Promise<string | null | undefined>;
  checkLocalReasoningAvailable?: () => Promise<boolean | undefined>;
};

export async function checkReasoningAvailability(electronAPI?: ElectronAPI): Promise<boolean> {
  try {
    const openaiKey = await electronAPI?.getOpenAIKey?.();
    const anthropicKey = await electronAPI?.getAnthropicKey?.();
    const geminiKey = await electronAPI?.getGeminiKey?.();
    const groqKey = await electronAPI?.getGroqKey?.();
    const localAvailable = await electronAPI?.checkLocalReasoningAvailable?.();

    logger.logReasoning("API_KEY_CHECK", {
      hasOpenAI: !!openaiKey,
      hasAnthropic: !!anthropicKey,
      hasGemini: !!geminiKey,
      hasGroq: !!groqKey,
      hasLocal: !!localAvailable,
    });

    return !!(openaiKey || anthropicKey || geminiKey || groqKey || localAvailable);
  } catch (error) {
    logger.logReasoning("API_KEY_CHECK_ERROR", {
      error: (error as Error).message,
      stack: (error as Error).stack,
      name: (error as Error).name,
    });
    return false;
  }
}

