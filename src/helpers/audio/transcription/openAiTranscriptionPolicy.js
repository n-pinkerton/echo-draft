import { countWords } from "../utils/wordCount";

export const SHORT_CLIP_DURATION_SECONDS = 2.5;
export const TRUNCATION_RETRY_MIN_DURATION_SECONDS = 12;
export const TRUNCATION_RETRY_MAX_WORDS_PER_SECOND = 0.6;
export const TRUNCATION_REJECT_MIN_WORDS_PER_SECOND = 0.2;
export const PROMPT_ECHO_UNKNOWN_DURATION_MIN_WORDS = 2;
export const PROMPT_ECHO_UNKNOWN_DURATION_MIN_CHARS = 6;
export const ASSISTANT_STYLE_RETRY_MIN_DURATION_SECONDS = 20;
export const ASSISTANT_STYLE_RETRY_MIN_WORDS = 80;
export const DEFAULT_SLOW_REQUEST_THRESHOLD_MS = 10_000;
export const DEFAULT_TRANSPORT_RETRY_DELAY_MS = 750;
export const MAX_RETRY_AFTER_MS = 5_000;

export const normalizeProxyDurationMs = (value) => {
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 && duration <= 3_600_000
    ? Math.round(duration)
    : null;
};

export const isRetryableHttpStatus = (status) =>
  status === 408 || status === 429 || (status >= 500 && status <= 599);

export const getRetryAfterMs = (response, fallbackMs, now = Date.now()) => {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return fallbackMs;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(250, Math.round(seconds * 1000)));
  }

  const retryAt = Date.parse(raw);
  if (Number.isFinite(retryAt)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(250, retryAt - now));
  }

  return fallbackMs;
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

export const hasOnlyPunctuation = (text = "") => /^[\s\p{P}\p{S}]+$/u.test(text);

export const getAgreementTokens = (text = "") =>
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

export const getAttemptAgreement = (primaryText, retryText) => {
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

export const createDisagreementError = (agreement) => {
  const error = new Error(
    "Transcription attempts disagreed, so EchoDraft will not choose the longer result automatically. Please retry."
  );
  error.code = "TRANSCRIPTION_ATTEMPTS_DISAGREE";
  error.agreement = agreement;
  return error;
};

export const analyzeCandidate = (text, { durationSeconds = null, promptEchoDetected = false } = {}) => {
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

export const isHardReject = (
  analysis,
  { durationSeconds = null, promptEchoDetected = false, corroboratedByRetry = false } = {}
) => {
  if (!analysis.trimmed || hasOnlyPunctuation(analysis.trimmed)) return true;
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
  return analysis.looksAssistantStyle;
};

export const combineTranscriptionTimings = (attempts) => {
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

export const applyCombinedTranscriptionTimings = (timings, attempts) => {
  if (!attempts.length) return;
  Object.assign(timings, combineTranscriptionTimings(attempts));
};

export const choosePreferredResult = (primaryResult, retryResult, context = {}) => {
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
