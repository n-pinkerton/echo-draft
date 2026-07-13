import { countWords } from "../utils/wordCount";

const ASSISTANT_ACTION_OPENERS = [
  /^(?:certainly|absolutely|sure|of course)[,!.:\s]/i,
  /^(?:here(?:'s| is| are)|done|completed)[,!.:\s]/i,
  /^i\s+(?:have|will|can|did|checked|created|updated|implemented)\b/i,
];

const CONTENT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "hers",
  "him",
  "his",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "ours",
  "she",
  "so",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "then",
  "they",
  "this",
  "to",
  "us",
  "was",
  "we",
  "were",
  "with",
  "you",
  "your",
  "yours",
]);

const NEGATION_MARKERS = ["not", "never", "without", "unless", "except"];
const CLEAR_SELF_CORRECTION = /\b(?:no[,]?\s+sorry|sorry[,]?\s+i mean|correction|make that)\b/i;

const normalizeContractions = (value) =>
  value
    .replace(/\bcan't\b/gi, "can not")
    .replace(/\bcannot\b/gi, "can not")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/\bshan't\b/gi, "shall not")
    .replace(/\bain't\b/gi, "is not")
    .replace(/\b([a-z]+)n't\b/gi, "$1 not");

const normalizeForComparison = (value) =>
  normalizeContractions(
    String(value || "")
      .normalize("NFKC")
      .replace(/[’‘]/g, "'")
  )
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim();

const getWords = (value) => normalizeForComparison(value).split(/\s+/).filter(Boolean);

const getContentWords = (value) =>
  new Set(
    getWords(value).filter(
      (word) => word.length >= 3 && !CONTENT_STOP_WORDS.has(word) && !/^\d+$/.test(word)
    )
  );

const getCriticalTokens = (value) => {
  const raw = String(value || "");
  const matches = raw.match(
    /(?:https?:\/\/|www\.)[^\s]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d[\d,.:/%-]*\b/giu
  );
  return Array.from(
    new Set(
      (matches || []).map((token) =>
        token
          .toLowerCase()
          .replace(/[),.;!?]+$/g, "")
          .replace(/,(?=\d)/g, "")
      )
    )
  );
};

const countMarker = (normalizedText, marker) => {
  const matches = normalizedText.match(new RegExp(`\\b${marker}\\b`, "g"));
  return matches?.length || 0;
};

/**
 * Apply a deliberately conservative, content-free acceptance check to AI cleanup output.
 * It catches gross compression, prompt execution, and loss of high-risk literals while
 * leaving nuanced language judgment to the cleanup model and review evals.
 */
export function assessCleanupFidelity(originalText, cleanedText) {
  const original = typeof originalText === "string" ? originalText.trim() : "";
  const cleaned = typeof cleanedText === "string" ? cleanedText.trim() : "";
  const originalWords = countWords(original);
  const cleanedWords = countWords(cleaned);
  const wordRatio =
    originalWords > 0 ? cleanedWords / originalWords : cleanedWords === 0 ? 1 : null;
  const reasons = [];

  if (!original) {
    if (cleaned) reasons.push("added-content-to-empty-input");
    return {
      accepted: reasons.length === 0,
      reasons,
      metrics: { originalWords, cleanedWords, wordRatio, contentCoverage: 1 },
    };
  }

  if (!cleaned) {
    reasons.push("empty-output");
  }

  if (cleaned && /<\/?echodraft_[^>]+>/i.test(cleaned)) {
    reasons.push("wrapper-leak");
  }

  if (
    cleaned &&
    ASSISTANT_ACTION_OPENERS.some((pattern) => pattern.test(cleaned)) &&
    !ASSISTANT_ACTION_OPENERS.some((pattern) => pattern.test(original))
  ) {
    reasons.push("assistant-action-output");
  }

  // Short and medium dictations have little redundancy: losing even a single
  // clause can still leave deceptively high lexical overlap. Route suspicious
  // compression through the strict-preservation retry instead of accepting a
  // polished summary. Longer dictations receive a little more room for genuine
  // filler and immediate-repetition removal.
  if (originalWords >= 20 && wordRatio !== null && wordRatio < (originalWords < 80 ? 0.82 : 0.75)) {
    reasons.push("material-compression");
  } else if (
    originalWords >= 8 &&
    wordRatio !== null &&
    wordRatio < (CLEAR_SELF_CORRECTION.test(original) ? 0.55 : 0.65)
  ) {
    reasons.push("material-compression");
  }

  if (
    originalWords >= 8 &&
    wordRatio !== null &&
    wordRatio > 1.8 &&
    cleanedWords - originalWords >= 30
  ) {
    reasons.push("material-expansion");
  }

  const normalizedOriginal = normalizeForComparison(original);
  const normalizedCleaned = normalizeForComparison(cleaned);
  const paddedNormalizedCleaned = ` ${normalizedCleaned} `;
  const criticalTokens = getCriticalTokens(original);
  const missingCriticalTokens = criticalTokens.filter(
    (token) => !paddedNormalizedCleaned.includes(` ${normalizeForComparison(token)} `)
  );
  if (missingCriticalTokens.length > 0) {
    reasons.push("critical-token-loss");
  }

  const changedNegations = NEGATION_MARKERS.filter(
    (marker) => countMarker(normalizedCleaned, marker) !== countMarker(normalizedOriginal, marker)
  );
  if (changedNegations.length > 0) {
    const lostNegation = changedNegations.some(
      (marker) => countMarker(normalizedCleaned, marker) < countMarker(normalizedOriginal, marker)
    );
    const addedNegation = changedNegations.some(
      (marker) => countMarker(normalizedCleaned, marker) > countMarker(normalizedOriginal, marker)
    );
    if (lostNegation) reasons.push("negation-loss");
    if (addedNegation) reasons.push("negation-addition");
  }

  if (original.includes("?") && !cleaned.includes("?")) {
    reasons.push("question-loss");
  }

  const originalContentWords = getContentWords(original);
  const cleanedContentWords = getContentWords(cleaned);
  let retainedContentWords = 0;
  for (const word of originalContentWords) {
    if (cleanedContentWords.has(word)) retainedContentWords += 1;
  }
  const contentCoverage =
    originalContentWords.size > 0 ? retainedContentWords / originalContentWords.size : 1;
  if (originalWords >= 20 && contentCoverage < 0.6) {
    reasons.push("low-content-word-coverage");
  }

  return {
    accepted: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    metrics: {
      originalWords,
      cleanedWords,
      wordRatio,
      contentCoverage,
      criticalTokenCount: criticalTokens.length,
      missingCriticalTokenCount: missingCriticalTokens.length,
    },
  };
}

export class CleanupFidelityError extends Error {
  constructor(assessment) {
    super("Cleanup output failed the preservation check; the original transcript was kept.");
    this.name = "CleanupFidelityError";
    this.code = "CLEANUP_FIDELITY_REJECTED";
    this.assessment = assessment;
  }
}
