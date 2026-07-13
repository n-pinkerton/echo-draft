import { API_ENDPOINTS, TOKEN_LIMITS } from "../../../config/constants";
import { getUserPrompt } from "../../../config/prompts";
import logger from "../../../utils/logger";
import {
  finiteNonNegativeNumber,
  normalizeProviderEnum,
  sanitizeEndpointForLogging,
  sanitizeProviderCode,
} from "../../../utils/diagnosticSanitizers";
import { withRetry, createApiRetryStrategy } from "../../../utils/retry";
import type { ReasoningConfig } from "../../BaseReasoningService";

export type OpenAiEndpointCandidate = { url: string; type: "responses" | "chat" };

const OPENAI_CLEANUP_TEXT_VERBOSITY = "medium";
const OPENAI_CLEANUP_MIN_OUTPUT_TOKENS = 2048;
const OPENAI_CLEANUP_MAX_OUTPUT_TOKENS = 32768;

export const calculateCleanupMaxOutputTokens = (
  inputTextLength: number,
  configuredMaxTokens?: number
): number => {
  if (typeof configuredMaxTokens === "number" && configuredMaxTokens > 0) {
    return Math.round(configuredMaxTokens);
  }

  const preservationBudget = Math.ceil(Math.max(0, inputTextLength) / 2) + 512;
  return Math.max(
    OPENAI_CLEANUP_MIN_OUTPUT_TOKENS,
    Math.min(OPENAI_CLEANUP_MAX_OUTPUT_TOKENS, preservationBudget)
  );
};

const getCleanupRequestTimeoutMs = (inputTextLength: number): number =>
  Math.max(60_000, Math.min(180_000, 45_000 + Math.max(0, inputTextLength)));

export async function processWithOpenAiProvider({
  text,
  model,
  agentName,
  config,
  apiKey,
  isCustomProvider,
  openAiBase,
  endpointCandidates,
  getSystemPrompt,
  calculateMaxTokens,
  getStoredOpenAiPreference,
  rememberOpenAiPreference,
  fetchFn = fetch,
}: {
  text: string;
  model: string;
  agentName: string | null;
  config: ReasoningConfig;
  apiKey: string;
  isCustomProvider: boolean;
  openAiBase: string;
  endpointCandidates: OpenAiEndpointCandidate[];
  getSystemPrompt: (agentName: string | null, modelId?: string | null) => string;
  calculateMaxTokens: (
    inputLength: number,
    minTokens: number,
    maxTokens: number,
    multiplier: number
  ) => number;
  getStoredOpenAiPreference: (base: string) => "responses" | "chat" | undefined;
  rememberOpenAiPreference: (base: string, preference: "responses" | "chat") => void;
  fetchFn?: typeof fetch;
}): Promise<string> {
  logger.logReasoning("OPENAI_START", {
    model,
    agentName,
    isCustomProvider,
    hasApiKey: Boolean(apiKey),
  });

  try {
    const systemPrompt = getSystemPrompt(agentName, model);
    const userPrompt = getUserPrompt(text, model);
    const responsesInput = [
      { role: "developer", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
    const chatMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const legacyCalculatedMaxTokens = calculateMaxTokens(
      text.length,
      TOKEN_LIMITS.MIN_TOKENS,
      TOKEN_LIMITS.MAX_TOKENS,
      TOKEN_LIMITS.TOKEN_MULTIPLIER
    );
    const maxOutputTokens = config.maxTokens
      ? calculateCleanupMaxOutputTokens(text.length, config.maxTokens)
      : Math.max(legacyCalculatedMaxTokens, calculateCleanupMaxOutputTokens(text.length));
    const requestTimeoutMs = getCleanupRequestTimeoutMs(text.length);
    const reasoningEffort = config.reasoningEffort || "none";
    const externalSignal = config.signal;

    const isOlderModel = model && (model.startsWith("gpt-4") || model.startsWith("gpt-3"));
    const isCustomEndpoint = openAiBase !== API_ENDPOINTS.OPENAI_BASE;

    logger.logReasoning("OPENAI_ENDPOINTS", {
      base: sanitizeEndpointForLogging(openAiBase),
      isCustomEndpoint,
      candidates: endpointCandidates.map((candidate) => sanitizeEndpointForLogging(candidate.url)),
      preference: getStoredOpenAiPreference(openAiBase) || null,
    });

    if (isCustomEndpoint) {
      logger.logReasoning("CUSTOM_TEXT_CLEANUP_REQUEST", {
        customBase: sanitizeEndpointForLogging(openAiBase),
        model,
        textLength: text.length,
        hasApiKey: Boolean(apiKey),
      });
    }

    const response = await withRetry(
      async () => {
        let lastError: Error | null = null;

        for (const { url: endpoint, type } of endpointCandidates) {
          const controller = new AbortController();
          let timeoutTriggered = false;
          const handleExternalAbort = () => controller.abort(externalSignal?.reason);
          if (externalSignal?.aborted) {
            controller.abort(externalSignal.reason);
          } else {
            externalSignal?.addEventListener("abort", handleExternalAbort, { once: true });
          }
          const timeoutId = setTimeout(() => {
            timeoutTriggered = true;
            controller.abort();
          }, requestTimeoutMs);
          try {
            const requestBody: any = { model };
            const usesOpenAiReasoningControls =
              !isCustomProvider && (model.startsWith("gpt-5") || model.includes("codex"));

            if (type === "responses") {
              requestBody.input = responsesInput;
              requestBody.store = false;
              requestBody.max_output_tokens = maxOutputTokens;
              if (usesOpenAiReasoningControls) {
                requestBody.reasoning = { effort: reasoningEffort };
                requestBody.text = { verbosity: OPENAI_CLEANUP_TEXT_VERBOSITY };
                requestBody.truncation = "disabled";
              }
            } else {
              requestBody.messages = chatMessages;
              if (isOlderModel) {
                requestBody.temperature = config.temperature || 0.3;
              }
              const usesMaxCompletionTokens = model.startsWith("gpt-5");
              if (usesMaxCompletionTokens) {
                requestBody.max_completion_tokens = maxOutputTokens;
              } else {
                requestBody.max_tokens = maxOutputTokens;
              }
              if (usesOpenAiReasoningControls) {
                requestBody.reasoning_effort = reasoningEffort;
              }
            }

            logger.logReasoning("OPENAI_REQUEST", {
              endpoint: sanitizeEndpointForLogging(endpoint),
              type,
              model,
              maxOutputTokens,
              inputTextLength: text.length,
              systemPromptLength: systemPrompt.length,
              userPromptLength: userPrompt.length,
              isOlderModel,
              temperature: requestBody.temperature ?? null,
              reasoningEffort: usesOpenAiReasoningControls ? reasoningEffort : null,
            });

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
              const errorData = await res.json().catch(() => ({}));
              const rawErrorCode =
                typeof (errorData.error?.code || errorData.code) === "string"
                  ? String(errorData.error?.code || errorData.code)
                  : null;
              const errorCode = sanitizeProviderCode(rawErrorCode);

              const isUnsupportedEndpoint =
                type === "responses" &&
                (res.status === 405 ||
                  (res.status === 404 &&
                    rawErrorCode !== "model_not_found" &&
                    rawErrorCode !== "invalid_model"));

              if (isUnsupportedEndpoint) {
                lastError = new Error("The cleanup endpoint is unsupported.");
                rememberOpenAiPreference(openAiBase, "chat");
                logger.logReasoning("OPENAI_ENDPOINT_FALLBACK", {
                  attemptedEndpoint: sanitizeEndpointForLogging(endpoint),
                  status: res.status,
                  errorCode,
                });
                continue;
              }

              if (rawErrorCode === "model_not_found" || rawErrorCode === "invalid_model") {
                const modelError = new Error(
                  "The selected cleanup model does not exist or is unavailable."
                ) as Error & {
                  status?: number;
                  response?: { status: number };
                  code?: string;
                  providerCode?: string | null;
                };
                modelError.status = res.status;
                modelError.response = { status: res.status };
                modelError.code = "REASONING_MODEL_UNAVAILABLE";
                modelError.providerCode = errorCode;
                throw modelError;
              }

              const apiError = new Error(
                `Cleanup provider request failed (HTTP ${res.status}).`
              ) as Error & {
                status?: number;
                response?: { status: number };
                code?: string | null;
                providerCode?: string | null;
              };
              apiError.status = res.status;
              apiError.response = { status: res.status };
              apiError.code = "REASONING_HTTP_ERROR";
              apiError.providerCode = errorCode;
              throw apiError;
            }

            rememberOpenAiPreference(openAiBase, type);
            return await res.json();
          } catch (error) {
            if ((error as Error).name === "AbortError") {
              if (externalSignal?.aborted) throw error;
              if (!timeoutTriggered) throw error;
              throw new Error(`Request timed out after ${Math.round(requestTimeoutMs / 1000)}s`);
            }
            if ((error as any)?.status) {
              lastError = error as Error;
              throw error;
            }
            const networkError = new Error("Unable to reach the cleanup provider.") as Error & {
              code?: string;
            };
            networkError.code = "REASONING_NETWORK_ERROR";
            lastError = networkError;
            throw networkError;
          } finally {
            clearTimeout(timeoutId);
            externalSignal?.removeEventListener("abort", handleExternalAbort);
          }
        }

        throw lastError || new Error("No OpenAI endpoint responded");
      },
      { ...createApiRetryStrategy(), signal: externalSignal }
    );

    const isResponsesApi = Array.isArray((response as any)?.output);
    const isChatCompletions = Array.isArray((response as any)?.choices);

    logger.logReasoning("OPENAI_RAW_RESPONSE", {
      model,
      format: isResponsesApi ? "responses" : isChatCompletions ? "chat_completions" : "unknown",
      hasOutput: isResponsesApi,
      outputLength: isResponsesApi ? response.output.length : 0,
      hasChoices: isChatCompletions,
      choicesLength: isChatCompletions ? response.choices.length : 0,
      status: normalizeProviderEnum(response?.status, ["completed", "incomplete", "failed"]),
      incompleteReason: normalizeProviderEnum(response?.incomplete_details?.reason, [
        "max_output_tokens",
      ]),
      totalTokens: finiteNonNegativeNumber(response?.usage?.total_tokens),
    });

    let responseText = "";
    let chatFinishReason: string | null = null;
    let responsesOutputTextPartsCount: number | null = null;
    let responsesOutputTextCombinedLength: number | null = null;

    if (typeof response?.output_text === "string" && response.output_text.trim()) {
      // Note: Some SDKs expose `output_text` as a convenience property.
      // Prefer it when present, otherwise fall back to aggregating `output` below.
      responseText = response.output_text.trim();
    }

    if (!responseText && isResponsesApi) {
      const parts: string[] = [];

      for (const item of response.output) {
        if (item?.type !== "message" || !Array.isArray(item.content)) {
          continue;
        }
        for (const content of item.content) {
          if (content?.type === "output_text" && typeof content.text === "string") {
            parts.push(content.text);
          }
        }
      }

      responsesOutputTextPartsCount = parts.length;
      responsesOutputTextCombinedLength = parts.reduce((sum, part) => sum + part.length, 0);
      responseText = parts.join("").trim();
    }

    if (!responseText && isChatCompletions) {
      for (const choice of response.choices) {
        const message = choice?.message ?? choice?.delta;
        const content = message?.content;

        if (typeof content === "string" && content.trim()) {
          responseText = content.trim();
          chatFinishReason = choice?.finish_reason || null;
          break;
        }

        if (Array.isArray(content)) {
          for (const part of content) {
            if (typeof part?.text === "string" && part.text.trim()) {
              responseText = part.text.trim();
              chatFinishReason = choice?.finish_reason || null;
              break;
            }
          }
        }

        if (responseText) break;

        if (typeof choice?.text === "string" && choice.text.trim()) {
          responseText = choice.text.trim();
          chatFinishReason = choice?.finish_reason || null;
          break;
        }
      }
    }

    logger.logReasoning("OPENAI_RESPONSE", {
      model,
      responseLength: responseText.length,
      tokensUsed: finiteNonNegativeNumber(response?.usage?.total_tokens) || 0,
      success: true,
      isEmpty: responseText.length === 0,
      finishReason: chatFinishReason,
      maxOutputTokens,
      responsesOutputTextPartsCount,
      responsesOutputTextCombinedLength,
    });

    // If the provider indicates truncation due to output limits, throw so callers can fall back
    // to the unmodified transcription rather than returning partial text.
    const status = typeof response?.status === "string" ? response.status : null;
    const incompleteReason =
      typeof response?.incomplete_details?.reason === "string"
        ? response.incomplete_details.reason
        : null;
    if (isResponsesApi && status && status !== "completed") {
      logger.logReasoning("OPENAI_OUTPUT_INCOMPLETE", {
        model,
        status,
        incompleteReason,
        responseLength: responseText.length,
        maxOutputTokens,
      });
      logger.warn(
        "OpenAI cleanup returned a non-complete response (Responses API)",
        { model, status, incompleteReason, responseLength: responseText.length, maxOutputTokens },
        "reasoning"
      );
      throw new Error(
        incompleteReason === "max_output_tokens"
          ? "OpenAI truncated the response due to max output tokens."
          : `OpenAI returned a non-complete cleanup response (${status}).`
      );
    }

    if (chatFinishReason && chatFinishReason !== "stop") {
      logger.logReasoning("OPENAI_OUTPUT_TRUNCATED", {
        model,
        finishReason: chatFinishReason,
        responseLength: responseText.length,
        maxOutputTokens,
      });
      logger.warn(
        "OpenAI cleanup truncated output (Chat Completions)",
        {
          model,
          finishReason: chatFinishReason,
          responseLength: responseText.length,
          maxOutputTokens,
        },
        "reasoning"
      );
      throw new Error(
        chatFinishReason === "length"
          ? "OpenAI truncated the response due to token limits."
          : "OpenAI returned an incomplete cleanup response."
      );
    }

    if (!responseText) {
      logger.logReasoning("OPENAI_EMPTY_RESPONSE", {
        model,
        originalTextLength: text.length,
        reason: "Empty response from API",
      });
      throw new Error("OpenAI returned an empty cleanup response.");
    }

    return responseText;
  } catch (error) {
    logger.logReasoning("OPENAI_ERROR", {
      model,
      errorCategory: (error as any)?.code || (error as Error).name || "unknown",
      status: finiteNonNegativeNumber((error as any)?.status),
      providerCode: sanitizeProviderCode((error as any)?.providerCode),
    });
    throw error;
  }
}
