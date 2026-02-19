import { API_ENDPOINTS, TOKEN_LIMITS } from "../../../config/constants";
import { getUserPrompt } from "../../../config/prompts";
import logger from "../../../utils/logger";
import { withRetry, createApiRetryStrategy } from "../../../utils/retry";
import type { ReasoningConfig } from "../../BaseReasoningService";

export type OpenAiEndpointCandidate = { url: string; type: "responses" | "chat" };

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
  getSystemPrompt: (agentName: string | null) => string;
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
    const systemPrompt = getSystemPrompt(agentName);
    const userPrompt = getUserPrompt(text);

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const maxOutputTokens =
      config.maxTokens ||
      Math.max(
        4096,
        calculateMaxTokens(
          text.length,
          TOKEN_LIMITS.MIN_TOKENS,
          TOKEN_LIMITS.MAX_TOKENS,
          TOKEN_LIMITS.TOKEN_MULTIPLIER
        )
      );

    const isOlderModel = model && (model.startsWith("gpt-4") || model.startsWith("gpt-3"));
    const isCustomEndpoint = openAiBase !== API_ENDPOINTS.OPENAI_BASE;

    logger.logReasoning("OPENAI_ENDPOINTS", {
      base: openAiBase,
      isCustomEndpoint,
      candidates: endpointCandidates.map((candidate) => candidate.url),
      preference: getStoredOpenAiPreference(openAiBase) || null,
    });

    if (isCustomEndpoint) {
      logger.logReasoning("CUSTOM_TEXT_CLEANUP_REQUEST", {
        customBase: openAiBase,
        model,
        textLength: text.length,
        hasApiKey: Boolean(apiKey),
        apiKeyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : "(none)",
      });
    }

    const response = await withRetry(async () => {
      let lastError: Error | null = null;

      for (const { url: endpoint, type } of endpointCandidates) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
          const requestBody: any = { model };

          if (type === "responses") {
            requestBody.input = messages;
            requestBody.store = false;
            requestBody.max_output_tokens = maxOutputTokens;
          } else {
            requestBody.messages = messages;
            if (isOlderModel) {
              requestBody.temperature = config.temperature || 0.3;
            }
            requestBody.max_tokens = maxOutputTokens;
          }

          logger.logReasoning("OPENAI_REQUEST", {
            endpoint,
            type,
            model,
            maxOutputTokens,
            inputTextLength: text.length,
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length,
            isOlderModel,
            temperature: requestBody.temperature ?? null,
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
            const errorData = await res.json().catch(() => ({ error: res.statusText }));
            const errorMessage =
              errorData.error?.message || errorData.message || `OpenAI API error: ${res.status}`;

            const isUnsupportedEndpoint =
              (res.status === 404 || res.status === 405) && type === "responses";

            if (isUnsupportedEndpoint) {
              lastError = new Error(errorMessage);
              rememberOpenAiPreference(openAiBase, "chat");
              logger.logReasoning("OPENAI_ENDPOINT_FALLBACK", {
                attemptedEndpoint: endpoint,
                error: errorMessage,
              });
              continue;
            }

            throw new Error(errorMessage);
          }

          rememberOpenAiPreference(openAiBase, type);
          return await res.json();
        } catch (error) {
          if ((error as Error).name === "AbortError") {
            throw new Error("Request timed out after 30s");
          }
          lastError = error as Error;
          if (type === "responses") {
            logger.logReasoning("OPENAI_ENDPOINT_FALLBACK", {
              attemptedEndpoint: endpoint,
              error: (error as Error).message,
            });
            continue;
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }
      }

      throw lastError || new Error("No OpenAI endpoint responded");
    }, createApiRetryStrategy());

    const isResponsesApi = Array.isArray((response as any)?.output);
    const isChatCompletions = Array.isArray((response as any)?.choices);

    logger.logReasoning("OPENAI_RAW_RESPONSE", {
      model,
      format: isResponsesApi ? "responses" : isChatCompletions ? "chat_completions" : "unknown",
      hasOutput: isResponsesApi,
      outputLength: isResponsesApi ? response.output.length : 0,
      outputTypes: isResponsesApi ? response.output.map((item: any) => item.type) : undefined,
      hasChoices: isChatCompletions,
      choicesLength: isChatCompletions ? response.choices.length : 0,
      status: typeof response?.status === "string" ? response.status : null,
      incompleteReason:
        typeof response?.incomplete_details?.reason === "string"
          ? response.incomplete_details.reason
          : null,
      usage: response.usage,
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
      tokensUsed: response.usage?.total_tokens || 0,
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
    if (status === "incomplete" && incompleteReason === "max_output_tokens") {
      logger.logReasoning("OPENAI_OUTPUT_TRUNCATED", {
        model,
        status,
        incompleteReason,
        responseLength: responseText.length,
        maxOutputTokens,
      });
      logger.warn(
        "OpenAI cleanup truncated output (Responses API)",
        { model, status, incompleteReason, responseLength: responseText.length, maxOutputTokens },
        "reasoning"
      );
      throw new Error(
        "OpenAI truncated the response due to max output tokens. Try a shorter input or increase max tokens."
      );
    }

    if (chatFinishReason === "length") {
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
        "OpenAI truncated the response due to token limits. Try a shorter input or increase max tokens."
      );
    }

    if (!responseText) {
      logger.logReasoning("OPENAI_EMPTY_RESPONSE_FALLBACK", {
        model,
        originalTextLength: text.length,
        reason: "Empty response from API",
      });
      return text;
    }

    return responseText;
  } catch (error) {
    logger.logReasoning("OPENAI_ERROR", {
      model,
      error: (error as Error).message,
      errorType: (error as Error).name,
    });
    throw error;
  }
}

