import { getBaseLanguageCode } from "../../../utils/languageSupport";
import {
  buildCustomDictionaryPromptForTranscription,
  getCustomDictionaryArray,
} from "./customDictionary";
import { isLikelyDictionaryPromptEcho } from "./dictionaryPromptEcho";
import { countWords } from "../utils/wordCount";

const SHORT_CLIP_DURATION_SECONDS = 2.5;
const TRUNCATION_RETRY_MIN_DURATION_SECONDS = 12;
const TRUNCATION_RETRY_MAX_WORDS_PER_SECOND = 0.6;
const TRUNCATION_REJECT_MIN_WORDS_PER_SECOND = 0.2;
const PROMPT_ECHO_UNKNOWN_DURATION_MIN_WORDS = 2;
const PROMPT_ECHO_UNKNOWN_DURATION_MIN_CHARS = 6;
const ASSISTANT_STYLE_RETRY_MIN_DURATION_SECONDS = 20;
const ASSISTANT_STYLE_RETRY_MIN_WORDS = 80;

const ASSISTANT_PREFIX_PATTERNS = [
  /^certainly[,.!\s]/i,
  /^absolutely[,.!\s]/i,
  /^sure[,.!\s]/i,
  /^of course[,.!\s]/i,
  /^here(?:'s| is)\b/i,
];

const ASSISTANT_CONTENT_PATTERNS = [
  /\n#{1,6}\s/m,
  /\*\*[^*]{2,}\*\*/,
  /(?:^|\n)\d+\.\s+/m,
  /\byour task is to\b/i,
  /\bclarifications?\b/i,
  /\brecommendations?\b/i,
  /\blet's break down\b/i,
];

const hasOnlyPunctuation = (text = "") => /^[\s\p{P}\p{S}]+$/u.test(text);

const analyzeCandidate = (text, { durationSeconds = null, promptEchoDetected = false } = {}) => {
  const rawText = typeof text === "string" ? text : "";
  const trimmed = rawText.trim();
  const words = countWords(trimmed);
  const chars = trimmed.length;
  const wordsPerSecond =
    typeof durationSeconds === "number" && durationSeconds > 0 ? words / durationSeconds : null;

  const assistantStyleSignals = [
    ASSISTANT_PREFIX_PATTERNS.some((pattern) => pattern.test(trimmed)),
    ...ASSISTANT_CONTENT_PATTERNS.map((pattern) => pattern.test(trimmed)),
  ];
  const assistantStyleScore = assistantStyleSignals.filter(Boolean).length;
  const looksAssistantStyle =
    assistantStyleScore >= 3 &&
    words >= ASSISTANT_STYLE_RETRY_MIN_WORDS &&
    typeof durationSeconds === "number" &&
    durationSeconds >= ASSISTANT_STYLE_RETRY_MIN_DURATION_SECONDS;

  const reasons = [];
  if (!trimmed) reasons.push("empty");
  if (hasOnlyPunctuation(trimmed)) reasons.push("punctuation-only");
  if (looksAssistantStyle) reasons.push("assistant-style-output");
  if (
    wordsPerSecond !== null &&
    typeof durationSeconds === "number" &&
    durationSeconds >= TRUNCATION_RETRY_MIN_DURATION_SECONDS &&
    words > 0 &&
    wordsPerSecond < TRUNCATION_RETRY_MAX_WORDS_PER_SECOND
  ) {
    reasons.push("suspiciously-short-for-duration");
  }
  if (
    promptEchoDetected &&
    wordsPerSecond === null &&
    (words < PROMPT_ECHO_UNKNOWN_DURATION_MIN_WORDS || chars < PROMPT_ECHO_UNKNOWN_DURATION_MIN_CHARS)
  ) {
    reasons.push("too-short-after-prompt-echo-retry");
  }

  let score = Math.min(words, 400);
  if (!trimmed) score -= 1000;
  if (hasOnlyPunctuation(trimmed)) score -= 300;
  if (looksAssistantStyle) score -= 500;
  if (
    wordsPerSecond !== null &&
    typeof durationSeconds === "number" &&
    durationSeconds >= TRUNCATION_RETRY_MIN_DURATION_SECONDS &&
    words > 0
  ) {
    if (wordsPerSecond < TRUNCATION_RETRY_MAX_WORDS_PER_SECOND) score -= 180;
    if (wordsPerSecond < TRUNCATION_REJECT_MIN_WORDS_PER_SECOND) score -= 220;
  }
  if (
    promptEchoDetected &&
    wordsPerSecond === null &&
    (words < PROMPT_ECHO_UNKNOWN_DURATION_MIN_WORDS || chars < PROMPT_ECHO_UNKNOWN_DURATION_MIN_CHARS)
  ) {
    score -= 220;
  }

  return {
    trimmed,
    words,
    chars,
    wordsPerSecond,
    assistantStyleScore,
    looksAssistantStyle,
    reasons,
    score,
  };
};

const isHardReject = (analysis, { durationSeconds = null, promptEchoDetected = false } = {}) => {
  if (!analysis.trimmed || hasOnlyPunctuation(analysis.trimmed)) {
    return true;
  }

  if (
    analysis.wordsPerSecond !== null &&
    typeof durationSeconds === "number" &&
    durationSeconds >= TRUNCATION_RETRY_MIN_DURATION_SECONDS &&
    analysis.words > 0 &&
    analysis.wordsPerSecond < TRUNCATION_REJECT_MIN_WORDS_PER_SECOND
  ) {
    return true;
  }

  if (
    promptEchoDetected &&
    analysis.wordsPerSecond === null &&
    (analysis.words < PROMPT_ECHO_UNKNOWN_DURATION_MIN_WORDS ||
      analysis.chars < PROMPT_ECHO_UNKNOWN_DURATION_MIN_CHARS)
  ) {
    return true;
  }

  if (analysis.looksAssistantStyle) {
    return true;
  }

  return false;
};

const choosePreferredResult = (primaryResult, retryResult, context = {}) => {
  const primaryText = typeof primaryResult?.rawText === "string" ? primaryResult.rawText : "";
  const retryText = typeof retryResult?.rawText === "string" ? retryResult.rawText : "";
  const primaryAnalysis = analyzeCandidate(primaryText, context);
  const retryAnalysis = analyzeCandidate(retryText, context);

  if (retryAnalysis.score > primaryAnalysis.score) {
    return { selected: retryResult, selectedName: "retry", primaryAnalysis, retryAnalysis };
  }

  return { selected: primaryResult, selectedName: "primary", primaryAnalysis, retryAnalysis };
};

export async function processWithOpenAIAPI(transcriber, audioBlob, metadata = {}, options = {}) {
  const skipDictionaryPrompt = options.skipDictionaryPrompt === true;
  const allowPromptEchoRetry = options.allowPromptEchoRetry !== false;
  const forceNoStream = options.forceNoStream === true;
  const allowTruncationRetry = options.allowTruncationRetry !== false;

  const timings = {};
  const language = getBaseLanguageCode(localStorage.getItem("preferredLanguage"));
  const allowLocalFallback = localStorage.getItem("allowLocalFallback") === "true";
  const fallbackModel = localStorage.getItem("fallbackWhisperModel") || "base";

  try {
    const durationSeconds = metadata.durationSeconds ?? null;
    const shouldSkipOptimizationForDuration =
      typeof durationSeconds === "number" &&
      durationSeconds > 0 &&
      durationSeconds < SHORT_CLIP_DURATION_SECONDS;

    const model = transcriber.getTranscriptionModel();
    const provider = localStorage.getItem("cloudTranscriptionProvider") || "openai";

    transcriber.logger?.debug?.(
      "Transcription request starting",
      {
        provider,
        model,
        blobSize: audioBlob.size,
        blobType: audioBlob.type,
        durationSeconds,
        language,
      },
      "transcription"
    );

    const is4oModel = model.includes("gpt-4o");
    const shouldOptimize =
      !is4oModel &&
      !shouldSkipOptimizationForDuration &&
      audioBlob.size > 1024 * 1024;

    transcriber.logger?.debug?.(
      "Audio optimization decision",
      { is4oModel, shouldOptimize, shouldSkipOptimizationForDuration },
      "transcription"
    );

    const [apiKey, optimizedAudio] = await Promise.all([
      transcriber.getAPIKey(),
      shouldOptimize ? transcriber.optimizeAudio(audioBlob) : Promise.resolve(audioBlob),
    ]);

    const transcribeOnce = async ({
      attemptLabel,
      attemptSkipDictionaryPrompt,
      attemptForceNoStream,
    }) => {
      const formData = new FormData();
      const mimeType = optimizedAudio.type || "audio/webm";
      const extension = mimeType.includes("webm")
        ? "webm"
        : mimeType.includes("ogg")
          ? "ogg"
          : mimeType.includes("mp4")
            ? "mp4"
            : mimeType.includes("mpeg")
              ? "mp3"
              : mimeType.includes("wav")
                ? "wav"
                : "webm";

      const dictionaryEntries = attemptSkipDictionaryPrompt ? [] : getCustomDictionaryArray();
      const dictionaryPromptPlan = buildCustomDictionaryPromptForTranscription({
        model,
        entries: dictionaryEntries,
      });
      const dictionaryPrompt = dictionaryPromptPlan.prompt;
      const dictionaryEntriesUsed = dictionaryPromptPlan.entriesUsed;
      const shouldAttachDictionaryPrompt = Boolean(dictionaryPrompt);

      const shouldStream =
        !attemptForceNoStream && transcriber.shouldStreamTranscription(model, provider);

      transcriber.logger?.debug?.(
        "FormData preparation",
        {
          attempt: attemptLabel,
          mimeType,
          extension,
          optimizedSize: optimizedAudio.size,
          hasApiKey: !!apiKey,
          shouldStream,
          forceNoStream: attemptForceNoStream,
          dictionaryEntriesCount: dictionaryEntriesUsed.length,
          dictionaryPromptLength: dictionaryPrompt ? dictionaryPrompt.length : 0,
          dictionaryPromptMode: dictionaryPromptPlan.mode,
        },
        "transcription"
      );

      formData.append("file", optimizedAudio, `audio.${extension}`);
      formData.append("model", model);
      if (language) {
        formData.append("language", language);
      }

      if (shouldAttachDictionaryPrompt) {
        formData.append("prompt", dictionaryPrompt);
      }

      if (shouldStream) {
        formData.append("stream", "true");
      }

      const endpoint = transcriber.getTranscriptionEndpoint();
      const apiCallStart = performance.now();

      if (provider === "mistral" && window.electronAPI?.proxyMistralTranscription) {
        const audioBuffer = await optimizedAudio.arrayBuffer();
        const proxyData = { audioBuffer, model, language };

        if (dictionaryPrompt) {
          const tokens = dictionaryPrompt
            .split(",")
            .flatMap((entry) => entry.trim().split(/\\s+/))
            .filter(Boolean)
            .slice(0, 100);
          if (tokens.length > 0) {
            proxyData.contextBias = tokens;
          }
        }

        const result = await window.electronAPI.proxyMistralTranscription(proxyData);
        const proxyText = result?.text;

        if (!proxyText || proxyText.trim().length === 0) {
          throw new Error("No text transcribed - Mistral response was empty");
        }

        const attemptDurationMs = Math.round(performance.now() - apiCallStart);
        return {
          rawText: proxyText,
          source: "mistral",
          timings: { transcriptionProcessingDurationMs: attemptDurationMs },
          dictionaryEntries: dictionaryEntriesUsed,
          shouldAttachDictionaryPrompt,
        };
      }
      transcriber.logger?.debug?.(
        "Making transcription API request",
        {
          endpoint,
          shouldStream,
          model,
          provider,
          hasApiKey: !!apiKey,
          apiKeyPreview: apiKey ? `${apiKey.substring(0, 8)}...` : "(none)",
        },
        "transcription"
      );

      const headers = {};
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetch(endpoint, { method: "POST", headers, body: formData });
      const responseContentType = response.headers.get("content-type") || "";
      const requestId =
        response.headers.get("x-request-id") ||
        response.headers.get("openai-request-id") ||
        null;

      transcriber.logger?.debug?.(
        "Transcription API response received",
        {
          status: response.status,
          statusText: response.statusText,
          contentType: responseContentType,
          requestId,
          ok: response.ok,
        },
        "transcription"
      );

      if (!response.ok) {
        const errorText = await response.text();
        transcriber.logger?.error?.(
          "Transcription API error response",
          { status: response.status, requestId, errorText },
          "transcription"
        );
        throw new Error(`API Error: ${response.status} ${errorText}`);
      }

      let result;
      const contentType = responseContentType;

      if (contentType.includes("text/event-stream")) {
        transcriber.logger?.debug?.(
          "Processing streaming response",
          { contentType, requestId },
          "transcription"
        );
        const streamedText = await transcriber.readTranscriptionStream(response);
        result = { text: streamedText };
      } else {
        const rawText = await response.text();
        try {
          result = JSON.parse(rawText);
        } catch (parseError) {
          transcriber.logger?.error?.(
            "Failed to parse JSON response",
            {
              requestId,
              parseError: parseError.message,
              rawText: rawText.substring(0, 500),
            },
            "transcription"
          );
          throw new Error(`Failed to parse API response: ${parseError.message}`);
        }
      }

      const attemptDurationMs = Math.round(performance.now() - apiCallStart);

      if (result.text && result.text.trim().length > 0) {
        return {
          rawText: result.text,
          source: "openai",
          timings: { transcriptionProcessingDurationMs: attemptDurationMs },
          dictionaryEntries: dictionaryEntriesUsed,
          shouldAttachDictionaryPrompt,
        };
      }

      throw new Error(
        "No text transcribed - audio may be too short, silent, or in an unsupported format"
      );
    };

    const combineTranscriptionTimings = (attempts) => {
      const total = attempts.reduce(
        (sum, attempt) => sum + (attempt?.timings?.transcriptionProcessingDurationMs || 0),
        0
      );
      return {
        transcriptionProcessingDurationMs: total,
        transcriptionAttemptCount: attempts.length,
        ...(attempts.length > 1 ? { transcriptionRetried: true } : {}),
      };
    };

    const transcribeWithDictionaryRetry = async ({
      attemptLabel,
      attemptSkipDictionaryPrompt,
      attemptForceNoStream,
    }) => {
      const firstAttempt = await transcribeOnce({
        attemptLabel,
        attemptSkipDictionaryPrompt,
        attemptForceNoStream,
      });

      const rawText = firstAttempt.rawText;
      if (
        firstAttempt.shouldAttachDictionaryPrompt &&
        isLikelyDictionaryPromptEcho(rawText, firstAttempt.dictionaryEntries)
      ) {
        transcriber.logger?.warn?.(
          "Transcription appears to have echoed the dictionary prompt. Retrying without prompt.",
          { model, provider, rawTextPreview: rawText.slice(0, 120) },
          "transcription"
        );

        if (allowPromptEchoRetry && !attemptSkipDictionaryPrompt) {
          const retryAttempt = await transcribeOnce({
            attemptLabel: `${attemptLabel}-noprompt`,
            attemptSkipDictionaryPrompt: true,
            attemptForceNoStream,
          });
          return {
            attempts: [firstAttempt, retryAttempt],
            result: retryAttempt,
            skipDictionaryPrompt: true,
            dictionaryPromptEchoDetected: true,
          };
        }

        throw new Error(
          "Transcription returned the dictionary prompt (likely no usable audio). Please try again."
        );
      }

      return {
        attempts: [firstAttempt],
        result: firstAttempt,
        skipDictionaryPrompt: attemptSkipDictionaryPrompt,
        dictionaryPromptEchoDetected: false,
      };
    };

    const attempts = [];
    const primary = await transcribeWithDictionaryRetry({
      attemptLabel: "primary",
      attemptSkipDictionaryPrompt: skipDictionaryPrompt,
      attemptForceNoStream: forceNoStream,
    });
    attempts.push(...primary.attempts);

    let activeResult = primary.result;
    let effectiveSkipDictionaryPrompt = primary.skipDictionaryPrompt;
    let promptEchoDetected = primary.dictionaryPromptEchoDetected === true;

    const primaryText = typeof activeResult.rawText === "string" ? activeResult.rawText : "";
    const primaryAnalysis = analyzeCandidate(primaryText, {
      durationSeconds,
      promptEchoDetected,
    });

    const shouldRetryAssistantStyle =
      !forceNoStream &&
      primaryAnalysis.looksAssistantStyle &&
      allowTruncationRetry;

    if (shouldRetryAssistantStyle) {
      transcriber.logger?.warn?.(
        "Transcription looks like assistant-generated text; retrying without prompt and without streaming",
        {
          model,
          provider,
          durationSeconds,
          words: primaryAnalysis.words,
          assistantStyleScore: primaryAnalysis.assistantStyleScore,
          preview: primaryText.slice(0, 160),
        },
        "transcription"
      );

      try {
        const retry = await transcribeWithDictionaryRetry({
          attemptLabel: "retry-assistant-style",
          attemptSkipDictionaryPrompt: true,
          attemptForceNoStream: true,
        });
        attempts.push(...retry.attempts);
        promptEchoDetected = promptEchoDetected || retry.dictionaryPromptEchoDetected === true;

        const selection = choosePreferredResult(activeResult, retry.result, {
          durationSeconds,
          promptEchoDetected,
        });
        if (selection.selectedName === "retry") {
          transcriber.logger?.warn?.(
            "Using assistant-style retry result",
            {
              primaryScore: selection.primaryAnalysis.score,
              retryScore: selection.retryAnalysis.score,
              primaryReasons: selection.primaryAnalysis.reasons,
              retryReasons: selection.retryAnalysis.reasons,
            },
            "transcription"
          );
          activeResult = retry.result;
        } else {
          transcriber.logger?.warn?.(
            "Keeping primary result after assistant-style retry",
            {
              primaryScore: selection.primaryAnalysis.score,
              retryScore: selection.retryAnalysis.score,
              primaryReasons: selection.primaryAnalysis.reasons,
              retryReasons: selection.retryAnalysis.reasons,
            },
            "transcription"
          );
        }
      } catch (retryError) {
        transcriber.logger?.warn?.(
          "Assistant-style retry failed; continuing with current transcription",
          { error: retryError?.message || String(retryError) },
          "transcription"
        );
      }
    }

    const rawText = typeof activeResult.rawText === "string" ? activeResult.rawText : "";
    const words = countWords(rawText);
    const wordsPerSecond =
      typeof durationSeconds === "number" && durationSeconds > 0 ? words / durationSeconds : null;

    const looksTruncated =
      allowTruncationRetry &&
      !forceNoStream &&
      typeof durationSeconds === "number" &&
      durationSeconds >= TRUNCATION_RETRY_MIN_DURATION_SECONDS &&
      wordsPerSecond !== null &&
      words > 0 &&
      wordsPerSecond < TRUNCATION_RETRY_MAX_WORDS_PER_SECOND;

    if (looksTruncated) {
      transcriber.logger?.warn?.(
        "Transcription looks suspiciously short for the recording duration; retrying",
        {
          model,
          provider,
          durationSeconds,
          words,
          wordsPerSecond: Number(wordsPerSecond.toFixed(3)),
          rawLength: rawText.length,
        },
        "transcription"
      );

      try {
        const retry = await transcribeWithDictionaryRetry({
          attemptLabel: "retry-truncation",
          attemptSkipDictionaryPrompt: effectiveSkipDictionaryPrompt,
          attemptForceNoStream: true,
        });
        attempts.push(...retry.attempts);
        promptEchoDetected = promptEchoDetected || retry.dictionaryPromptEchoDetected === true;

        const selection = choosePreferredResult(activeResult, retry.result, {
          durationSeconds,
          promptEchoDetected,
        });
        if (selection.selectedName === "retry") {
          transcriber.logger?.warn?.(
            "Using retry transcription result",
            {
              primaryScore: selection.primaryAnalysis.score,
              retryScore: selection.retryAnalysis.score,
              primaryReasons: selection.primaryAnalysis.reasons,
              retryReasons: selection.retryAnalysis.reasons,
            },
            "transcription"
          );
          activeResult = retry.result;
        } else {
          transcriber.logger?.warn?.(
            "Keeping primary transcription result after retry",
            {
              primaryScore: selection.primaryAnalysis.score,
              retryScore: selection.retryAnalysis.score,
              primaryReasons: selection.primaryAnalysis.reasons,
              retryReasons: selection.retryAnalysis.reasons,
            },
            "transcription"
          );
        }
      } catch (retryError) {
        transcriber.logger?.warn?.(
          "Truncation retry failed; continuing with primary transcription",
          { error: retryError?.message || String(retryError) },
          "transcription"
        );
      }
    }

    const finalRawText = typeof activeResult.rawText === "string" ? activeResult.rawText : "";
    const finalAnalysis = analyzeCandidate(finalRawText, {
      durationSeconds,
      promptEchoDetected,
    });
    const hardReject = isHardReject(finalAnalysis, { durationSeconds, promptEchoDetected });
    if (hardReject) {
      transcriber.logger?.warn?.(
        "Rejecting unreliable transcription output",
        {
          model,
          provider,
          durationSeconds,
          words: finalAnalysis.words,
          wordsPerSecond:
            finalAnalysis.wordsPerSecond !== null ? Number(finalAnalysis.wordsPerSecond.toFixed(3)) : null,
          reasons: finalAnalysis.reasons,
          preview: finalRawText.slice(0, 200),
          attemptsCount: attempts.length,
          promptEchoDetected,
        },
        "transcription"
      );
      throw new Error(
        "Transcription result appears unreliable (too short or likely model-generated). Please retry."
      );
    }

    const combinedTimings = combineTranscriptionTimings(attempts);
    timings.transcriptionProcessingDurationMs = combinedTimings.transcriptionProcessingDurationMs;
    timings.transcriptionAttemptCount = combinedTimings.transcriptionAttemptCount;
    if (combinedTimings.transcriptionRetried) {
      timings.transcriptionRetried = true;
    }

    let cleanedText = finalRawText;
    let source = activeResult.source || "openai";

    if (transcriber.shouldApplyReasoningCleanup?.()) {
      transcriber.emitProgress?.({ stage: "cleaning", stageLabel: "Cleaning up" });
      const reasoningStart = performance.now();
      cleanedText = await transcriber.reasoningCleanupService.processTranscription(
        finalRawText,
        source,
        transcriber.getCleanupEnabledOverride?.() ?? null
      );
      timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
      source = `${source}-reasoned`;
    }

    return { success: true, text: cleanedText || finalRawText, rawText: finalRawText, source, timings };
  } catch (error) {
    const isOpenAIMode = localStorage.getItem("useLocalWhisper") !== "true";

    if (allowLocalFallback && isOpenAIMode) {
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const options = { model: fallbackModel };
        if (language && language !== "auto") {
          options.language = language;
        }

        const result = await window.electronAPI.transcribeLocalWhisper(arrayBuffer, options);
        if (result.success && result.text) {
          const text = await transcriber.reasoningCleanupService.processTranscription(
            result.text,
            "local-fallback",
            transcriber.getCleanupEnabledOverride?.() ?? null
          );
          if (text) {
            return { success: true, text, source: "local-fallback" };
          }
        }

        throw error;
      } catch (fallbackError) {
        throw new Error(
          `OpenAI API failed: ${error.message}. Local fallback also failed: ${fallbackError.message}`
        );
      }
    }

    throw error;
  }
}
