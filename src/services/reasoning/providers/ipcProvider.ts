import { getUserPrompt } from "../../../config/prompts";
import logger from "../../../utils/logger";
import type { ReasoningConfig } from "../../BaseReasoningService";

export async function processWithIpcProvider({
  providerName,
  text,
  model,
  agentName,
  config,
  getSystemPrompt,
  ipcCall,
}: {
  providerName: string;
  text: string;
  model: string;
  agentName: string | null;
  config: ReasoningConfig;
  getSystemPrompt: (agentName: string | null) => string;
  ipcCall: (userPrompt: string, model: string, agentName: string | null, options: any) => Promise<any>;
}): Promise<string> {
  logger.logReasoning(`${providerName.toUpperCase()}_START`, {
    model,
    agentName,
    environment: typeof window !== "undefined" ? "browser" : "node",
  });

  if (typeof window === "undefined") {
    throw new Error(`${providerName} reasoning is not available in this environment`);
  }

  const startTime = Date.now();

  logger.logReasoning(`${providerName.toUpperCase()}_IPC_CALL`, {
    model,
    textLength: text.length,
  });

  const systemPrompt = getSystemPrompt(agentName);
  const userPrompt = getUserPrompt(text);
  const result = await ipcCall(userPrompt, model, agentName, {
    ...config,
    systemPrompt,
  });

  const processingTime = Date.now() - startTime;

  if (result.success) {
    logger.logReasoning(`${providerName.toUpperCase()}_SUCCESS`, {
      model,
      processingTimeMs: processingTime,
      resultLength: result.text.length,
    });
    return result.text;
  }

  logger.logReasoning(`${providerName.toUpperCase()}_ERROR`, {
    model,
    processingTimeMs: processingTime,
    error: result.error,
  });
  throw new Error(result.error);
}

