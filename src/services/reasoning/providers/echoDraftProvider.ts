import logger from "../../../utils/logger";
import { withSessionRefresh } from "../../../lib/neonAuth";
import type { ReasoningConfig } from "../../BaseReasoningService";

export async function processWithEchoDraftProvider({
  text,
  model,
  agentName,
  _config,
  getCustomDictionary,
  getPreferredLanguage,
  cloudReason,
}: {
  text: string;
  model: string;
  agentName: string | null;
  _config: ReasoningConfig;
  getCustomDictionary: () => string[];
  getPreferredLanguage: () => string;
  cloudReason: (text: string, payload: any) => Promise<any>;
}): Promise<string> {
  logger.logReasoning("OPENWHISPR_START", { model, agentName });

  const customDictionary = getCustomDictionary();
  const language = getPreferredLanguage();

  // Use withSessionRefresh to handle AUTH_EXPIRED automatically
  const result = await withSessionRefresh(async () => {
    const res = await cloudReason(text, {
      model,
      agentName,
      customDictionary,
      language,
    });

    if (!res.success) {
      const err: any = new Error(res.error || "EchoDraft cloud reasoning failed");
      err.code = res.code;
      throw err;
    }

    return res;
  });

  logger.logReasoning("OPENWHISPR_SUCCESS", {
    model: result.model,
    provider: result.provider,
    resultLength: result.text.length,
  });

  return result.text;
}

