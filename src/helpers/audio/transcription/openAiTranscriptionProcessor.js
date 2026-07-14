import { getBaseLanguageCode } from "../../../utils/languageSupport";
import { sanitizeOpaqueRequestId, sanitizeProviderCode } from "../../../utils/diagnosticSanitizers";
import { invokeCancelableIpc } from "../../../utils/cancelableIpc";
import {
  buildCustomDictionaryPromptForTranscription,
  getCustomDictionaryArray,
  getTrustedTranscriptionDictionaryArray,
} from "./customDictionary";
import { isLikelyDictionaryPromptEcho } from "./dictionaryPromptEcho";
import { countWords } from "../utils/wordCount";
import {
  createTranscriptionCancelledError,
  isTranscriptionCancelled,
  throwIfTranscriptionCancelled,
} from "../pipeline/cancellation";

const SHORT_CLIP_DURATION_SECONDS = 2.5;
const TRUNCATION_RETRY_MIN_DURATION_SECONDS = 12;
const TRUNCATION_RETRY_MAX_WORDS_PER_SECOND = 0.6;
const TRUNCATION_REJECT_MIN_WORDS_PER_SECOND = 0.2;
const PROMPT_ECHO_UNKNOWN_DURATION_MIN_WORDS = 2;
const PROMPT_ECHO_UNKNOWN_DURATION_MIN_CHARS = 6;
const ASSISTANT_STYLE_RETRY_MIN_DURATION_SECONDS = 20;
const ASSISTANT_STYLE_RETRY_MIN_WORDS = 80;
const DEFAULT_SLOW_REQUEST_THRESHOLD_MS = 10_000;
const DEFAULT_TRANSPORT_RETRY_DELAY_MS = 750;
const MAX_RETRY_AFTER_MS = 5_000;

const normalizeProxyDurationMs = (value) => {
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 && duration <= 3_600_000
    ? Math.round(duration)
    : null;
};

const isRetryableHttpStatus = (status) =>
  status === 408 || status === 429 || (status >= 500 && status <= 599);

const getRetryAfterMs = (response, fallbackMs) => {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return fallbackMs;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(250, Math.round(seconds * 1000)));
  }

  const retryAt = Date.parse(raw);
  if (Number.isFinite(retryAt)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(250, retryAt - Date.now()));
  }

  return fallbackMs;
};

const waitForRetryDelay = async (delayMs, signal) => {
  throwIfTranscriptionCancelled(signal);
  if (!delayMs || delayMs <= 0) return;

  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(createTranscriptionCancelledError());
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
};

const readBlobAsArrayBuffer = async (blob) => {
  if (typeof blob?.arrayBuffer === "function") {
    return await blob.arrayBuffer();
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read recorded audio"));
    reader.readAsArrayBuffer(blob);
  });
};

const createBoundedProxyResponse = (proxyResponse) => {
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(proxyResponse?.headers || {})) {
    const normalizedName = String(name).toLowerCase();
    const value = typeof rawValue === "string" ? rawValue : "";
    if (
      !["content-type", "retry-after", "x-request-id", "openai-request-id"].includes(
        normalizedName
      ) ||
      !value ||
      value.length > 512 ||
      /[\r\n\0]/.test(value)
    ) {
      continue;
    }
    try {
      headers.set(normalizedName, value);
    } catch {
      // Provider metadata is optional. Ignore malformed values rather than failing transcription.
    }
  }
  return new Response(typeof proxyResponse?.body === "string" ? proxyResponse.body : "", {
    status: Number(proxyResponse?.status) || 500,
    headers,
  });
};

const getProviderLabel = (provider) => {
  if (provider === "openai") return "OpenAI";
  if (provider === "groq") return "Groq";
  if (provider === "mistral") return "Mistral";
  return "The transcription provider";
};

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

const getAgreementTokens = (text = "") =>
  String(text)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];

const getMultisetMatchCount = (sourceItems, candidateItems) => {
  const remaining = new Map();
  for (const item of candidateItems) {
    remaining.set(item, (remaining.get(item) || 0) + 1);
  }

  let matched = 0;
  for (const item of sourceItems) {
    const count = remaining.get(item) || 0;
    if (count > 0) {
      matched += 1;
      remaining.set(item, count - 1);
    }
  }
  return matched;
};

const getAttemptAgreement = (primaryText, retryText) => {
  const primaryTokens = getAgreementTokens(primaryText);
  const retryTokens = getAgreementTokens(retryText);
  if (primaryTokens.length === 0 || retryTokens.length === 0) {
    return { agreed: false, tokenCoverage: 0, bigramCoverage: 0 };
  }

  const [shorterTokens, longerTokens] =
    primaryTokens.length <= retryTokens.length
      ? [primaryTokens, retryTokens]
      : [retryTokens, primaryTokens];
  const tokenMatches = getMultisetMatchCount(shorterTokens, longerTokens);
  const tokenCoverage = tokenMatches / shorterTokens.length;
  const symmetricTokenCoverage = tokenMatches / longerTokens.length;
  const shorterBigrams = shorterTokens
    .slice(0, -1)
    .map((token, index) => `${token}\u0000${shorterTokens[index + 1]}`);
  const longerBigrams = longerTokens
    .slice(0, -1)
    .map((token, index) => `${token}\u0000${longerTokens[index + 1]}`);
  const bigramMatches = getMultisetMatchCount(shorterBigrams, longerBigrams);
  const bigramCoverage =
    shorterBigrams.length > 0 ? bigramMatches / shorterBigrams.length : tokenCoverage;
  const symmetricBigramCoverage =
    longerBigrams.length > 0 ? bigramMatches / longerBigrams.length : symmetricTokenCoverage;
  const lengthRatio = longerTokens.length / shorterTokens.length;
  const strictPrefixExtension =
    shorterTokens.length < longerTokens.length &&
    shorterTokens.every((token, index) => token === longerTokens[index]);
  const baseAgreement =
    tokenCoverage >= 0.72 && (shorterTokens.length < 4 || bigramCoverage >= 0.4);
  const agreed =
    baseAgreement &&
    !strictPrefixExtension &&
    symmetricTokenCoverage >= 0.9 &&
    (longerTokens.length < 4 || symmetricBigramCoverage >= 0.8);
  const requiresCorroboration = baseAgreement && !agreed && lengthRatio > 1.05;

  return {
    agreed,
    baseAgreement,
    requiresCorroboration,
    tokenCoverage,
    symmetricTokenCoverage,
    bigramCoverage,
    symmetricBigramCoverage,
    lengthRatio,
    strictPrefixExtension,
  };
};

const createDisagreementError = (agreement) => {
  const error = new Error(
    "Transcription attempts disagreed, so EchoDraft will not choose the longer result automatically. Please retry."
  );
  error.code = "TRANSCRIPTION_ATTEMPTS_DISAGREE";
  error.agreement = agreement;
  return error;
};

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
    (words < PROMPT_ECHO_UNKNOWN_DURATION_MIN_WORDS ||
      chars < PROMPT_ECHO_UNKNOWN_DURATION_MIN_CHARS)
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
    (words < PROMPT_ECHO_UNKNOWN_DURATION_MIN_WORDS ||
      chars < PROMPT_ECHO_UNKNOWN_DURATION_MIN_CHARS)
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

const isHardReject = (
  analysis,
  { durationSeconds = null, promptEchoDetected = false, corroboratedByRetry = false } = {}
) => {
  if (!analysis.trimmed || hasOnlyPunctuation(analysis.trimmed)) {
    return true;
  }

  if (
    analysis.wordsPerSecond !== null &&
    typeof durationSeconds === "number" &&
    durationSeconds >= TRUNCATION_RETRY_MIN_DURATION_SECONDS &&
    analysis.words > 0 &&
    analysis.wordsPerSecond < TRUNCATION_REJECT_MIN_WORDS_PER_SECOND &&
    !corroboratedByRetry
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

const combineTranscriptionTimings = (attempts) => {
  const total = attempts.reduce(
    (sum, attempt) => sum + (attempt?.timings?.transcriptionProcessingDurationMs || 0),
    0
  );
  const transportAttempts = attempts.flatMap((attempt, index) =>
    (attempt?.timings?.transcriptionTransportAttempts || []).map((transportAttempt) => ({
      ...transportAttempt,
      transcriptionAttempt: index + 1,
      attemptLabel: attempt.attemptLabel || `attempt-${index + 1}`,
    }))
  );
  const requestIds = transportAttempts.map((attempt) => attempt.requestId).filter(Boolean);
  const lastSuccessfulAttempt = [...attempts]
    .reverse()
    .find((attempt) => attempt.attemptOutcome === "success");
  const lastAttempt = lastSuccessfulAttempt?.timings || attempts.at(-1)?.timings || {};
  const attemptSummaries = attempts.map((attempt, index) => ({
    attempt: index + 1,
    label: attempt.attemptLabel || `attempt-${index + 1}`,
    outcome: attempt.attemptOutcome || "success",
    durationMs: attempt?.timings?.transcriptionProcessingDurationMs || 0,
    transportAttemptCount: attempt?.timings?.transcriptionTransportAttempts?.length || 0,
  }));
  return {
    transcriptionProcessingDurationMs: total,
    transcriptionAttemptCount: attempts.length,
    ...(attempts.length > 1 ? { transcriptionRetried: true } : {}),
    transcriptionTransportAttemptCount: transportAttempts.length,
    ...(attempts.some(
      (attempt) => (attempt?.timings?.transcriptionTransportAttempts?.length || 0) > 1
    )
      ? { transcriptionTransportRetried: true }
      : {}),
    transcriptionTimeToHeadersMs: lastAttempt.transcriptionTimeToHeadersMs ?? null,
    transcriptionBodyReadDurationMs: lastAttempt.transcriptionBodyReadDurationMs ?? null,
    ...(lastAttempt.transcriptionRequestId
      ? { transcriptionRequestId: lastAttempt.transcriptionRequestId }
      : {}),
    ...(requestIds.length > 0 ? { transcriptionRequestIds: requestIds } : {}),
    transcriptionAttempts: attemptSummaries,
    transcriptionTransportAttempts: transportAttempts,
  };
};

const applyCombinedTranscriptionTimings = (timings, attempts) => {
  if (!attempts.length) return;

  const combined = combineTranscriptionTimings(attempts);
  Object.assign(timings, combined);
};

const choosePreferredResult = (primaryResult, retryResult, context = {}) => {
  const primaryText = typeof primaryResult?.rawText === "string" ? primaryResult.rawText : "";
  const retryText = typeof retryResult?.rawText === "string" ? retryResult.rawText : "";
  const primaryAnalysis = analyzeCandidate(primaryText, context);
  const retryAnalysis = analyzeCandidate(retryText, context);
  const agreement = getAttemptAgreement(primaryText, retryText);

  if (context.requireAgreement === true && !agreement.agreed) {
    return {
      selected: null,
      selectedName: "disagreement",
      primaryAnalysis,
      retryAnalysis,
      agreement,
    };
  }

  if (retryAnalysis.score > primaryAnalysis.score) {
    return {
      selected: retryResult,
      selectedName: "retry",
      primaryAnalysis,
      retryAnalysis,
      agreement,
    };
  }

  return {
    selected: primaryResult,
    selectedName: "primary",
    primaryAnalysis,
    retryAnalysis,
    agreement,
  };
};

export async function processWithOpenAIAPI(transcriber, audioBlob, metadata = {}, options = {}) {
  const skipDictionaryPrompt = options.skipDictionaryPrompt === true;
  const allowPromptEchoRetry = options.allowPromptEchoRetry !== false;
  const forceNoStream = options.forceNoStream === true;
  const allowTruncationRetry = options.allowTruncationRetry !== false;
  const externalSignal = options.signal || null;
  const slowRequestThresholdMs =
    Number.isFinite(options.slowRequestThresholdMs) && options.slowRequestThresholdMs >= 0
      ? options.slowRequestThresholdMs
      : DEFAULT_SLOW_REQUEST_THRESHOLD_MS;
  const transportRetryDelayMs =
    Number.isFinite(options.transportRetryDelayMs) && options.transportRetryDelayMs >= 0
      ? options.transportRetryDelayMs
      : DEFAULT_TRANSPORT_RETRY_DELAY_MS;
  const requestTimeoutOverrideMs =
    Number.isFinite(options.requestTimeoutMs) && options.requestTimeoutMs > 0
      ? options.requestTimeoutMs
      : null;
  let remainingTransportRetries = options.allowTransportRetry === false ? 0 : 1;

  const timings = {};
  const transcriptionAttemptLedger = [];
  const language = getBaseLanguageCode(localStorage.getItem("preferredLanguage"));
  const allowLocalFallback = localStorage.getItem("allowLocalFallback") === "true";
  const fallbackModel = localStorage.getItem("fallbackWhisperModel") || "base";

  try {
    throwIfTranscriptionCancelled(externalSignal);
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
      !is4oModel && !shouldSkipOptimizationForDuration && audioBlob.size > 1024 * 1024;

    transcriber.logger?.debug?.(
      "Audio optimization decision",
      { is4oModel, shouldOptimize, shouldSkipOptimizationForDuration },
      "transcription"
    );

    const [apiKey, optimizedAudio] = await Promise.all([
      transcriber.getAPIKey(),
      shouldOptimize ? transcriber.optimizeAudio(audioBlob) : Promise.resolve(audioBlob),
    ]);
    throwIfTranscriptionCancelled(externalSignal);

    const performTranscribeOnce = async ({
      attemptLabel,
      attemptSkipDictionaryPrompt,
      attemptForceNoStream,
    }) => {
      const mimeType = optimizedAudio.type || "audio/webm";

      const customDictionaryEntries = attemptSkipDictionaryPrompt ? [] : getCustomDictionaryArray();
      const dictionaryEntries = attemptSkipDictionaryPrompt
        ? []
        : getTrustedTranscriptionDictionaryArray();
      const dictionaryPromptPlan = buildCustomDictionaryPromptForTranscription({
        model,
        entries: dictionaryEntries,
      });
      const dictionaryEntriesUsed = dictionaryPromptPlan.entriesUsed;
      const shouldAttachDictionaryPrompt = dictionaryPromptPlan.mode === "structured-openai";

      const shouldStream =
        !attemptForceNoStream && transcriber.shouldStreamTranscription(model, provider);

      transcriber.logger?.debug?.(
        "FormData preparation",
        {
          attempt: attemptLabel,
          mimeType,
          optimizedSize: optimizedAudio.size,
          hasApiKey: !!apiKey,
          shouldStream,
          forceNoStream: attemptForceNoStream,
          dictionaryEntriesCount: dictionaryEntriesUsed.length,
          dictionaryPromptMode: dictionaryPromptPlan.mode,
        },
        "transcription"
      );

      const endpoint = transcriber.getTranscriptionEndpoint();
      const apiCallStart = performance.now();

      transcriber.logger?.debug?.(
        "Making transcription API request",
        {
          endpoint,
          shouldStream,
          model,
          provider,
          hasApiKey: !!apiKey,
        },
        "transcription"
      );

      const requestTimeoutMs =
        requestTimeoutOverrideMs ||
        Math.max(60_000, Math.min(300_000, 30_000 + (Number(durationSeconds) || 0) * 1_500));
      const transportAttempts = [];
      let transportAttempt = 0;

      while (true) {
        transportAttempt += 1;
        throwIfTranscriptionCancelled(externalSignal);

        const transportStartedAt = performance.now();
        const controller = new AbortController();
        let timeoutTriggered = false;
        let response = null;
        let requestId = null;
        let timeToHeadersMs = null;
        let bodyReadDurationMs = null;
        let attemptRecorded = false;
        const handleExternalAbort = () => controller.abort(externalSignal?.reason);
        if (externalSignal) {
          if (externalSignal.aborted) {
            throw createTranscriptionCancelledError();
          }
          externalSignal.addEventListener("abort", handleExternalAbort, { once: true });
        }
        const timeoutId = setTimeout(() => {
          timeoutTriggered = true;
          controller.abort();
        }, requestTimeoutMs);
        const slowTimerId = setTimeout(() => {
          if (externalSignal?.aborted) return;
          transcriber.emitProgress?.({
            stage: "transcribing",
            stageLabel: "Still transcribing",
            message: `${getProviderLabel(provider)} is taking longer than usual`,
            isSlow: true,
            canCancel: true,
            transportAttempt,
          });
        }, slowRequestThresholdMs);

        try {
          const secureTransport = window.electronAPI?.providerTranscriptionRequest;
          if (!secureTransport) throw new Error("Secure transcription transport is unavailable");
          const audioBuffer = await readBlobAsArrayBuffer(optimizedAudio);
          const contextBias =
            provider === "mistral" && customDictionaryEntries.length > 0
              ? customDictionaryEntries.slice(0, 100)
              : undefined;
          const proxyResponse = await invokeCancelableIpc(controller.signal, (ipcRequestId) =>
            secureTransport(
              {
                provider,
                endpoint,
                audioBuffer,
                mimeType: optimizedAudio.type || mimeType,
                model,
                language,
                stream: shouldStream,
                ...(contextBias?.length ? { contextBias } : {}),
                ...(provider === "openai" && dictionaryEntriesUsed.length
                  ? { dictionaryEntries: dictionaryEntriesUsed }
                  : {}),
              },
              ipcRequestId,
              (progress) => {
                if (
                  controller.signal.aborted ||
                  externalSignal?.aborted ||
                  !Number.isSafeInteger(progress?.generatedChars) ||
                  progress.generatedChars < 0 ||
                  !Number.isSafeInteger(progress?.generatedWords) ||
                  progress.generatedWords < 0
                ) {
                  return;
                }
                transcriber.emitProgress?.({
                  stage: "transcribing",
                  stageLabel: "Transcribing",
                  generatedChars: progress.generatedChars,
                  generatedWords: progress.generatedWords,
                  isSlow: false,
                  transportRetrying: false,
                  transportAttempt,
                });
              }
            )
          );
          response = createBoundedProxyResponse(proxyResponse);
          timeToHeadersMs =
            normalizeProxyDurationMs(proxyResponse?.timings?.timeToHeadersMs) ??
            Math.round(performance.now() - transportStartedAt);
          const responseContentType = response.headers.get("content-type") || "";
          requestId = sanitizeOpaqueRequestId(
            response.headers.get("x-request-id") || response.headers.get("openai-request-id")
          );
          const responseFormat = responseContentType.includes("text/event-stream")
            ? "event-stream"
            : responseContentType.includes("json")
              ? "json"
              : "other";

          transcriber.logger?.debug?.(
            "Transcription API response received",
            {
              status: response.status,
              responseFormat,
              requestId,
              ok: response.ok,
              transportAttempt,
              timeToHeadersMs,
            },
            "transcription"
          );

          const bodyReadStartedAt = performance.now();
          if (!response.ok) {
            const errorText = await response.text();
            bodyReadDurationMs =
              normalizeProxyDurationMs(proxyResponse?.timings?.bodyReadDurationMs) ??
              Math.round(performance.now() - bodyReadStartedAt);
            let providerErrorCode = null;
            try {
              const errorData = JSON.parse(errorText);
              providerErrorCode = sanitizeProviderCode(
                errorData?.error?.code || errorData?.code || null
              );
            } catch {
              // Provider response bodies are intentionally excluded from diagnostics and UI.
            }
            const error = new Error(
              `Transcription provider request failed (HTTP ${response.status}).`
            );
            error.code = "TRANSCRIPTION_HTTP_ERROR";
            error.httpStatus = response.status;
            error.providerErrorCode = providerErrorCode;
            error.requestId = requestId;
            error.retryable = isRetryableHttpStatus(response.status);
            error.retryAfterMs = getRetryAfterMs(response, transportRetryDelayMs);
            transcriber.logger?.error?.(
              "Transcription API error response",
              {
                status: response.status,
                requestId,
                errorCode: providerErrorCode,
                retryable: error.retryable,
                transportAttempt,
              },
              "transcription"
            );
            throw error;
          }

          let result;
          if (responseContentType.includes("text/event-stream")) {
            transcriber.logger?.debug?.(
              "Processing streaming response",
              { contentType: responseContentType, requestId, transportAttempt },
              "transcription"
            );
            const streamedText = await transcriber.readTranscriptionStream(response);
            throwIfTranscriptionCancelled(externalSignal);
            result = { text: streamedText };
          } else {
            const rawText = await response.text();
            throwIfTranscriptionCancelled(externalSignal);
            try {
              result = JSON.parse(rawText);
            } catch {
              transcriber.logger?.error?.(
                "Failed to parse JSON response",
                {
                  requestId,
                  errorCategory: "invalid_json",
                  responseLength: rawText.length,
                },
                "transcription"
              );
              const invalidResponseError = new Error(
                "Transcription provider returned an invalid response."
              );
              invalidResponseError.code = "TRANSCRIPTION_INVALID_RESPONSE";
              invalidResponseError.retryable = false;
              throw invalidResponseError;
            }
          }
          bodyReadDurationMs =
            normalizeProxyDurationMs(proxyResponse?.timings?.bodyReadDurationMs) ??
            Math.round(performance.now() - bodyReadStartedAt);
          transportAttempts.push({
            attempt: transportAttempt,
            status: response.status,
            requestId,
            outcome: "success",
            timeToHeadersMs,
            bodyReadDurationMs,
            durationMs: Math.round(performance.now() - transportStartedAt),
          });
          attemptRecorded = true;

          if (result.text && result.text.trim().length > 0) {
            const attemptDurationMs = Math.round(performance.now() - apiCallStart);
            const requestIds = transportAttempts.map((entry) => entry.requestId).filter(Boolean);
            transcriber.emitProgress?.({
              stage: "transcribing",
              stageLabel: "Transcribing",
              message: null,
              isSlow: false,
              canCancel: true,
              transportAttempt,
              transportRetrying: false,
            });
            return {
              rawText: result.text,
              source: provider,
              timings: {
                transcriptionProcessingDurationMs: attemptDurationMs,
                transcriptionTimeToHeadersMs: timeToHeadersMs,
                transcriptionBodyReadDurationMs: bodyReadDurationMs,
                transcriptionTransportAttemptCount: transportAttempts.length,
                ...(transportAttempts.length > 1 ? { transcriptionTransportRetried: true } : {}),
                ...(requestId ? { transcriptionRequestId: requestId } : {}),
                ...(requestIds.length > 0 ? { transcriptionRequestIds: requestIds } : {}),
                transcriptionTransportAttempts: transportAttempts,
              },
              dictionaryEntries: dictionaryEntriesUsed,
              shouldAttachDictionaryPrompt,
            };
          }

          throw new Error(
            "No text transcribed - audio may be too short, silent, or in an unsupported format"
          );
        } catch (caughtError) {
          if (externalSignal?.aborted) {
            throw createTranscriptionCancelledError();
          }

          let error = caughtError;
          if (timeoutTriggered || (error?.name === "AbortError" && !externalSignal?.aborted)) {
            error = new Error(
              `Transcription request timed out after ${Math.round(requestTimeoutMs / 1000)}s`
            );
            error.code = "TRANSCRIPTION_TIMEOUT";
            error.retryable = true;
          } else if (error?.retryable === undefined && error?.name === "TypeError") {
            const networkError = new Error("Network error while contacting transcription provider");
            networkError.code = "TRANSCRIPTION_NETWORK_ERROR";
            networkError.retryable = true;
            networkError.cause = error;
            error = networkError;
          }

          if (!attemptRecorded) {
            transportAttempts.push({
              attempt: transportAttempt,
              status: response?.status ?? null,
              requestId,
              outcome: error?.code || "error",
              retryable: error?.retryable === true,
              timeToHeadersMs,
              bodyReadDurationMs,
              durationMs: Math.round(performance.now() - transportStartedAt),
            });
            attemptRecorded = true;
          }
          error.transportAttempts = transportAttempts;

          if (error?.retryable === true && remainingTransportRetries > 0) {
            remainingTransportRetries -= 1;
            const retryDelayMs = error.retryAfterMs ?? transportRetryDelayMs;
            transcriber.logger?.warn?.(
              "Retrying transcription after a transient transport failure",
              {
                attempt: transportAttempt,
                nextAttempt: transportAttempt + 1,
                errorCode: error.code || null,
                status: error.httpStatus || null,
                requestId: error.requestId || requestId,
                retryDelayMs,
              },
              "transcription"
            );
            transcriber.emitProgress?.({
              stage: "transcribing",
              stageLabel: "Retrying transcription",
              message: "Temporary provider problem; retrying once",
              isSlow: false,
              canCancel: true,
              transportAttempt: transportAttempt + 1,
              transportRetrying: true,
            });
            await waitForRetryDelay(retryDelayMs, externalSignal);
            continue;
          }

          throw error;
        } finally {
          // Keep the abort deadline active while the response body or SSE stream is consumed.
          clearTimeout(timeoutId);
          clearTimeout(slowTimerId);
          externalSignal?.removeEventListener("abort", handleExternalAbort);
        }
      }
    };

    const transcribeOnce = async (attemptOptions) => {
      const attemptStartedAt = performance.now();
      try {
        const result = await performTranscribeOnce(attemptOptions);
        transcriptionAttemptLedger.push({
          ...result,
          attemptLabel: attemptOptions.attemptLabel,
          attemptOutcome: "success",
        });
        return result;
      } catch (error) {
        if (!isTranscriptionCancelled(error, externalSignal)) {
          transcriptionAttemptLedger.push({
            attemptLabel: attemptOptions.attemptLabel,
            attemptOutcome:
              typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
                ? error.code
                : "error",
            timings: {
              transcriptionProcessingDurationMs: Math.round(performance.now() - attemptStartedAt),
              transcriptionTransportAttempts: Array.isArray(error?.transportAttempts)
                ? error.transportAttempts
                : [],
            },
          });
        }
        throw error;
      }
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
          { model, provider, resultLength: rawText.length },
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
    let recoveredFromIncompleteStream = false;
    let suspectedIncomplete = false;
    let primary;
    try {
      primary = await transcribeWithDictionaryRetry({
        attemptLabel: "primary",
        attemptSkipDictionaryPrompt: skipDictionaryPrompt,
        attemptForceNoStream: forceNoStream,
      });
    } catch (error) {
      if (!forceNoStream && error?.code === "TRANSCRIPTION_STREAM_INCOMPLETE") {
        recoveredFromIncompleteStream = true;
        transcriber.logger?.warn?.(
          "Streaming transcription ended early; retrying with a complete non-streaming response",
          { model, provider, durationSeconds },
          "transcription"
        );
        primary = await transcribeWithDictionaryRetry({
          attemptLabel: "retry-incomplete-stream",
          attemptSkipDictionaryPrompt: skipDictionaryPrompt,
          attemptForceNoStream: true,
        });
      } else {
        throw error;
      }
    }
    attempts.push(...primary.attempts);

    let activeResult = primary.result;
    let effectiveSkipDictionaryPrompt = primary.skipDictionaryPrompt;
    let promptEchoDetected = primary.dictionaryPromptEchoDetected === true;
    let corroboratedByRetry = false;

    const primaryText = typeof activeResult.rawText === "string" ? activeResult.rawText : "";
    const primaryAnalysis = analyzeCandidate(primaryText, {
      durationSeconds,
      promptEchoDetected,
    });

    const shouldRetryAssistantStyle =
      !forceNoStream && primaryAnalysis.looksAssistantStyle && allowTruncationRetry;

    if (shouldRetryAssistantStyle) {
      transcriber.logger?.warn?.(
        "Transcription looks like assistant-generated text; retrying without prompt and without streaming",
        {
          model,
          provider,
          durationSeconds,
          words: primaryAnalysis.words,
          assistantStyleScore: primaryAnalysis.assistantStyleScore,
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
          requireAgreement: true,
        });
        corroboratedByRetry = selection.agreement.agreed;
        if (selection.selectedName === "disagreement") {
          if (!selection.agreement.requiresCorroboration) {
            throw createDisagreementError(selection.agreement);
          }

          transcriber.logger?.warn?.(
            "Longer transcription needs an independent corroborating attempt",
            {
              model,
              provider,
              lengthRatio: Number(selection.agreement.lengthRatio.toFixed(3)),
              symmetricTokenCoverage: Number(selection.agreement.symmetricTokenCoverage.toFixed(3)),
            },
            "transcription"
          );

          let corroboration;
          try {
            corroboration = await transcribeWithDictionaryRetry({
              attemptLabel: "corroborate-truncation",
              // Vary the prompt conditions so this is evidence from a distinct request path,
              // not merely a repeat that can reproduce a prompt-correlated hallucination.
              attemptSkipDictionaryPrompt: true,
              attemptForceNoStream: true,
            });
          } catch (error) {
            const disagreementError = createDisagreementError(selection.agreement);
            disagreementError.cause = error;
            throw disagreementError;
          }
          attempts.push(...corroboration.attempts);
          promptEchoDetected =
            promptEchoDetected || corroboration.dictionaryPromptEchoDetected === true;

          const corroborationSelection = choosePreferredResult(retry.result, corroboration.result, {
            durationSeconds,
            promptEchoDetected,
            requireAgreement: true,
          });
          if (!corroborationSelection.agreement.agreed) {
            throw createDisagreementError(corroborationSelection.agreement);
          }

          corroboratedByRetry = true;
          activeResult = corroborationSelection.selected;
          transcriber.logger?.warn?.(
            "Using independently corroborated truncation recovery",
            {
              selectedAttempt: corroborationSelection.selectedName,
              tokenCoverage: Number(
                corroborationSelection.agreement.symmetricTokenCoverage.toFixed(3)
              ),
            },
            "transcription"
          );
        } else if (selection.selectedName === "retry") {
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
        if (retryError?.code === "TRANSCRIPTION_ATTEMPTS_DISAGREE") {
          throw retryError;
        }
        suspectedIncomplete = true;
        timings.transcriptionSuspectedIncomplete = true;
        timings.transcriptionRecoveryFailed = true;
        timings.transcriptionRecoveryFailureCode =
          typeof retryError?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(retryError.code)
            ? retryError.code
            : "error";
        transcriber.logger?.warn?.(
          "Truncation retry failed; preserving primary transcription with an incomplete warning",
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
    const hardReject = isHardReject(finalAnalysis, {
      durationSeconds,
      promptEchoDetected,
      corroboratedByRetry,
    });
    if (hardReject) {
      transcriber.logger?.warn?.(
        "Rejecting unreliable transcription output",
        {
          model,
          provider,
          durationSeconds,
          words: finalAnalysis.words,
          wordsPerSecond:
            finalAnalysis.wordsPerSecond !== null
              ? Number(finalAnalysis.wordsPerSecond.toFixed(3))
              : null,
          reasons: finalAnalysis.reasons,
          attemptsCount: transcriptionAttemptLedger.length,
          promptEchoDetected,
        },
        "transcription"
      );
      throw new Error(
        "Transcription result appears unreliable (too short or likely model-generated). Please retry."
      );
    }

    applyCombinedTranscriptionTimings(timings, transcriptionAttemptLedger);
    if (recoveredFromIncompleteStream) {
      timings.transcriptionStreamRecovery = true;
    }

    let cleanedText = finalRawText;
    let source = activeResult.source || "openai";
    let cleanup = null;

    if (transcriber.shouldApplyReasoningCleanup?.()) {
      throwIfTranscriptionCancelled(externalSignal);
      transcriber.emitProgress?.({
        stage: "cleaning",
        stageLabel: "Cleaning up",
        canCancel: true,
      });
      const reasoningStart = performance.now();
      const cleanupEnabledOverride = transcriber.getCleanupEnabledOverride?.() ?? null;
      if (
        typeof transcriber.reasoningCleanupService?.processTranscriptionWithOutcome === "function"
      ) {
        const cleanupResult =
          await transcriber.reasoningCleanupService.processTranscriptionWithOutcome(
            finalRawText,
            source,
            cleanupEnabledOverride,
            { signal: externalSignal }
          );
        cleanedText = cleanupResult.text;
        cleanup = cleanupResult.cleanup;
      } else {
        cleanedText = await transcriber.reasoningCleanupService.processTranscription(
          finalRawText,
          source,
          cleanupEnabledOverride,
          { signal: externalSignal }
        );
        cleanup = {
          requested: true,
          attempted: true,
          applied: true,
          status: cleanedText === finalRawText ? "unchanged" : "applied",
        };
      }
      timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
      throwIfTranscriptionCancelled(externalSignal);
      if (cleanup?.applied) {
        source = `${source}-reasoned`;
      }
    }

    return {
      success: true,
      text: cleanedText || finalRawText,
      rawText: finalRawText,
      source,
      timings,
      ...(suspectedIncomplete ? { suspectedIncomplete: true } : {}),
      ...(cleanup ? { cleanup } : {}),
    };
  } catch (error) {
    if (isTranscriptionCancelled(error, externalSignal)) {
      throw createTranscriptionCancelledError();
    }
    const isOpenAIMode = localStorage.getItem("useLocalWhisper") !== "true";

    if (allowLocalFallback && isOpenAIMode) {
      applyCombinedTranscriptionTimings(timings, transcriptionAttemptLedger);
      timings.cloudTranscriptionFailed = true;
      timings.cloudTranscriptionFailureCode =
        typeof error?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
          ? error.code
          : "error";
      try {
        const localFallbackStartedAt = performance.now();
        const arrayBuffer = await audioBlob.arrayBuffer();
        const options = { model: fallbackModel };
        if (language && language !== "auto") {
          options.language = language;
        }

        const result = await invokeCancelableIpc(externalSignal, (requestId) =>
          window.electronAPI.transcribeLocalWhisper(arrayBuffer, options, requestId)
        );
        throwIfTranscriptionCancelled(externalSignal);
        if (result.success && result.text) {
          timings.localFallbackUsed = true;
          timings.localFallbackProcessingDurationMs = Math.round(
            performance.now() - localFallbackStartedAt
          );
          const rawText = result.text;
          try {
            if (
              typeof transcriber.reasoningCleanupService?.processTranscriptionWithOutcome ===
              "function"
            ) {
              const cleanupResult =
                await transcriber.reasoningCleanupService.processTranscriptionWithOutcome(
                  rawText,
                  "local-fallback",
                  transcriber.getCleanupEnabledOverride?.() ?? null,
                  { signal: externalSignal }
                );
              if (cleanupResult.text) {
                return {
                  success: true,
                  text: cleanupResult.text,
                  rawText,
                  source: cleanupResult.cleanup?.applied
                    ? "local-fallback-reasoned"
                    : "local-fallback",
                  timings,
                  cleanup: cleanupResult.cleanup,
                };
              }
            } else if (
              typeof transcriber.reasoningCleanupService?.processTranscription === "function"
            ) {
              const text = await transcriber.reasoningCleanupService.processTranscription(
                rawText,
                "local-fallback",
                transcriber.getCleanupEnabledOverride?.() ?? null,
                { signal: externalSignal }
              );
              if (text) {
                return {
                  success: true,
                  text,
                  rawText,
                  source: "local-fallback-reasoned",
                  timings,
                };
              }
            }
          } catch (cleanupError) {
            if (isTranscriptionCancelled(cleanupError, externalSignal)) {
              throw createTranscriptionCancelledError();
            }
            timings.localFallbackCleanupFailed = true;
            transcriber.logger?.warn?.(
              "Cleanup failed after local transcription recovery; preserving the raw local transcript",
              {},
              "transcription"
            );
          }

          return {
            success: true,
            text: rawText,
            rawText,
            source: "local-fallback",
            timings,
          };
        }

        throw error;
      } catch (fallbackError) {
        if (isTranscriptionCancelled(fallbackError, externalSignal)) {
          throw createTranscriptionCancelledError();
        }
        const combinedError = new Error(
          "Cloud transcription and local fallback both failed. Please retry."
        );
        combinedError.code = "TRANSCRIPTION_AND_FALLBACK_FAILED";
        throw combinedError;
      }
    }

    throw error;
  }
}
