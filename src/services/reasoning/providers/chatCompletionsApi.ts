import { TOKEN_LIMITS } from "../../../config/constants";
import { getUserPrompt } from "../../../config/prompts";
import { getCloudModel } from "../../../models/ModelRegistry";
import logger from "../../../utils/logger";
import {
  finiteNonNegativeNumber,
  normalizeProviderEnum,
  sanitizeEndpointForLogging,
  sanitizeProviderCode,
} from "../../../utils/diagnosticSanitizers";
import { withRetry, createApiRetryStrategy } from "../../../utils/retry";
import type { ReasoningConfig } from "../../BaseReasoningService";

export async function callChatCompletionsApi({
  endpoint,
  apiKey,
  model,
  text,
  agentName,
  config,
  providerName,
  getSystemPrompt,
  calculateMaxTokens,
  fetchFn = fetch,
}: {
  endpoint: string;
  apiKey: string;
  model: string;
  text: string;
  agentName: string | null;
  config: ReasoningConfig;
  providerName: string;
  getSystemPrompt: (agentName: string | null, modelId?: string | null) => string;
  calculateMaxTokens: (
    inputLength: number,
    minTokens: number,
    maxTokens: number,
    multiplier: number
  ) => number;
  fetchFn?: typeof fetch;
}): Promise<string> {
  const systemPrompt = getSystemPrompt(agentName, model);
  const userPrompt = getUserPrompt(text, model);

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const requestBody: any = {
    model,
    messages,
    temperature: config.temperature ?? 0.3,
    max_tokens:
      config.maxTokens ||
      Math.max(
        4096,
        calculateMaxTokens(
          text.length,
          TOKEN_LIMITS.MIN_TOKENS,
          TOKEN_LIMITS.MAX_TOKENS,
          TOKEN_LIMITS.TOKEN_MULTIPLIER
        )
      ),
  };

  // Disable thinking for Groq Qwen models
  const modelDef = getCloudModel(model);
  if (modelDef?.disableThinking && providerName.toLowerCase() === "groq") {
    requestBody.reasoning_effort = "none";
  }

  logger.logReasoning(`${providerName.toUpperCase()}_REQUEST`, {
    endpoint: sanitizeEndpointForLogging(endpoint),
    model,
    hasApiKey: Boolean(apiKey),
    inputTextLength: text.length,
    maxOutputTokens: requestBody.max_tokens,
  });

  const response = await withRetry(
    async () => {
      const controller = new AbortController();
      let timeoutTriggered = false;
      const handleExternalAbort = () => controller.abort(config.signal?.reason);
      if (config.signal?.aborted) controller.abort(config.signal.reason);
      else config.signal?.addEventListener("abort", handleExternalAbort, { once: true });
      const timeoutId = setTimeout(() => {
        timeoutTriggered = true;
        controller.abort();
      }, 30000);
      try {
        const res = await fetchFn(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorText = await res.text();
          let errorData: any = {};

          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = {};
          }

          logger.logReasoning(`${providerName.toUpperCase()}_API_ERROR_DETAIL`, {
            status: res.status,
            errorCode: sanitizeProviderCode(errorData.error?.code || errorData.code || null),
          });

          const apiError = new Error(
            `${providerName} cleanup request failed (HTTP ${res.status}).`
          ) as Error & {
            status?: number;
            response?: { status: number };
            code?: string;
          };
          apiError.status = res.status;
          apiError.response = { status: res.status };
          apiError.code = "REASONING_HTTP_ERROR";
          throw apiError;
        }

        const jsonResponse = await res.json();

        logger.logReasoning(`${providerName.toUpperCase()}_RAW_RESPONSE`, {
          hasResponse: Boolean(jsonResponse),
          hasChoices: Boolean(jsonResponse?.choices),
          choicesLength: jsonResponse?.choices?.length || 0,
        });

        return jsonResponse;
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          if (config.signal?.aborted) throw error;
          if (!timeoutTriggered) throw error;
          throw new Error("Request timed out after 30s");
        }
        if ((error as any)?.status) throw error;
        const networkError = new Error(
          `Unable to reach the ${providerName} cleanup provider.`
        ) as Error & { code?: string };
        networkError.code = "REASONING_NETWORK_ERROR";
        throw networkError;
      } finally {
        clearTimeout(timeoutId);
        config.signal?.removeEventListener("abort", handleExternalAbort);
      }
    },
    { ...createApiRetryStrategy(), signal: config.signal }
  );

  if (!response.choices || !response.choices[0]) {
    logger.logReasoning(`${providerName.toUpperCase()}_RESPONSE_ERROR`, {
      model,
      hasChoices: Boolean(response.choices),
      choicesCount: response.choices?.length || 0,
    });
    throw new Error(`Invalid response structure from ${providerName} API`);
  }

  const choice = response.choices[0];
  const responseText = choice.message?.content?.trim() || "";
  const finishReason = normalizeProviderEnum(choice.finish_reason, [
    "stop",
    "length",
    "content_filter",
    "tool_calls",
  ]);

  if (finishReason && finishReason !== "stop") {
    logger.logReasoning(`${providerName.toUpperCase()}_OUTPUT_INCOMPLETE`, {
      model,
      finishReason,
      responseLength: responseText.length,
    });
    const error = new Error(
      finishReason === "length"
        ? `${providerName} truncated the cleanup response at its output limit.`
        : `${providerName} returned a non-complete cleanup response (${finishReason}).`
    ) as Error & { code?: string; finishReason?: string };
    error.code = "CLEANUP_INCOMPLETE";
    error.finishReason = finishReason;
    throw error;
  }

  if (!responseText) {
    logger.logReasoning(`${providerName.toUpperCase()}_EMPTY_RESPONSE`, {
      model,
      finishReason,
      hasMessage: Boolean(choice.message),
    });
    throw new Error(`${providerName} returned empty response`);
  }

  logger.logReasoning(`${providerName.toUpperCase()}_RESPONSE`, {
    model,
    responseLength: responseText.length,
    tokensUsed: finiteNonNegativeNumber(response?.usage?.total_tokens) || 0,
    success: true,
  });

  return responseText;
}
