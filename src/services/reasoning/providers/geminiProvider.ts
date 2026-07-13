import { API_ENDPOINTS, TOKEN_LIMITS } from "../../../config/constants";
import { getUserPrompt } from "../../../config/prompts";
import logger from "../../../utils/logger";
import { withRetry, createApiRetryStrategy } from "../../../utils/retry";
import type { ReasoningConfig } from "../../BaseReasoningService";

export async function processWithGeminiProvider({
  text,
  model,
  agentName,
  config,
  apiKey,
  getSystemPrompt,
  calculateMaxTokens,
  fetchFn = fetch,
}: {
  text: string;
  model: string;
  agentName: string | null;
  config: ReasoningConfig;
  apiKey: string;
  getSystemPrompt: (agentName: string | null, modelId?: string | null) => string;
  calculateMaxTokens: (
    inputLength: number,
    minTokens: number,
    maxTokens: number,
    multiplier: number
  ) => number;
  fetchFn?: typeof fetch;
}): Promise<string> {
  logger.logReasoning("GEMINI_START", {
    model,
    agentName,
    hasApiKey: Boolean(apiKey),
  });

  const systemPrompt = getSystemPrompt(agentName, model);
  const userPrompt = getUserPrompt(text, model);

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `${systemPrompt}\n\n${userPrompt}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: config.temperature || 0.3,
      maxOutputTokens:
        config.maxTokens ||
        Math.max(
          2000,
          calculateMaxTokens(
            text.length,
            TOKEN_LIMITS.MIN_TOKENS_GEMINI,
            TOKEN_LIMITS.MAX_TOKENS_GEMINI,
            TOKEN_LIMITS.TOKEN_MULTIPLIER
          )
        ),
    },
  };

  let response: any;
  try {
    response = await withRetry(
      async () => {
        logger.logReasoning("GEMINI_REQUEST", {
          endpoint: `${API_ENDPOINTS.GEMINI}/models/${model}:generateContent`,
          model,
          hasApiKey: Boolean(apiKey),
          inputTextLength: text.length,
          maxOutputTokens: requestBody.generationConfig.maxOutputTokens,
        });

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
          const res = await fetchFn(`${API_ENDPOINTS.GEMINI}/models/${model}:generateContent`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          if (!res.ok) {
            const errorText = await res.text();
            let errorData: any = { error: res.statusText };

            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { error: errorText || res.statusText };
            }

            logger.logReasoning("GEMINI_API_ERROR_DETAIL", {
              status: res.status,
              statusText: res.statusText,
              errorCode: errorData.error?.code || errorData.code || null,
              errorMessage: errorData.error?.message || errorData.message || errorData.error,
            });

            const errorMessage =
              errorData.error?.message ||
              errorData.message ||
              errorData.error ||
              `Gemini API error: ${res.status}`;
            const apiError = new Error(errorMessage) as Error & {
              status?: number;
              response?: { status: number };
            };
            apiError.status = res.status;
            apiError.response = { status: res.status };
            throw apiError;
          }

          const jsonResponse = await res.json();

          logger.logReasoning("GEMINI_RAW_RESPONSE", {
            hasResponse: Boolean(jsonResponse),
            responseKeys: jsonResponse ? Object.keys(jsonResponse) : [],
            hasCandidates: Boolean(jsonResponse?.candidates),
            candidatesLength: jsonResponse?.candidates?.length || 0,
          });

          return jsonResponse;
        } catch (error) {
          if ((error as Error).name === "AbortError") {
            if (config.signal?.aborted) throw error;
            if (!timeoutTriggered) throw error;
            throw new Error("Request timed out after 30s");
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
          config.signal?.removeEventListener("abort", handleExternalAbort);
        }
      },
      { ...createApiRetryStrategy(), signal: config.signal }
    );
  } catch (fetchError) {
    logger.logReasoning("GEMINI_FETCH_ERROR", {
      error: (fetchError as Error).message,
      stack: (fetchError as Error).stack,
    });
    throw fetchError;
  }

  if (!response.candidates || !response.candidates[0]) {
    logger.logReasoning("GEMINI_RESPONSE_ERROR", {
      model,
      hasCandidate: Boolean(response.candidates),
      candidateCount: response.candidates?.length || 0,
    });
    throw new Error("Invalid response structure from Gemini API");
  }

  const candidate = response.candidates[0];
  const finishReason =
    typeof candidate.finishReason === "string" ? candidate.finishReason.trim().toUpperCase() : null;
  if (finishReason && finishReason !== "STOP") {
    logger.logReasoning("GEMINI_OUTPUT_INCOMPLETE", {
      model,
      finishReason,
      responseLength: candidate.content?.parts?.[0]?.text?.length || 0,
    });
    const error = new Error(
      finishReason === "MAX_TOKENS"
        ? "Gemini truncated the cleanup response at its output limit."
        : `Gemini returned a non-complete cleanup response (${finishReason}).`
    ) as Error & { code?: string; finishReason?: string };
    error.code = "CLEANUP_INCOMPLETE";
    error.finishReason = finishReason;
    throw error;
  }

  if (!candidate.content?.parts?.[0]?.text) {
    logger.logReasoning("GEMINI_EMPTY_RESPONSE", {
      model,
      finishReason: candidate.finishReason,
      hasContent: Boolean(candidate.content),
      hasParts: Boolean(candidate.content?.parts),
    });

    throw new Error("Gemini returned empty response");
  }

  const responseText = candidate.content.parts[0].text.trim();

  logger.logReasoning("GEMINI_RESPONSE", {
    model,
    responseLength: responseText.length,
    tokensUsed: response.usageMetadata?.totalTokenCount || 0,
    success: true,
  });

  return responseText;
}
