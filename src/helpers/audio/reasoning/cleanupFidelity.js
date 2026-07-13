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
const RELATION_MARKERS = [
  "after",
  "although",
  "because",
  "before",
  "finally",
  "first",
  "however",
  "later",
  "next",
  "once",
  "otherwise",
  "subsequently",
  "then",
  "until",
  "when",
  "while",
];
const CLEAR_SELF_CORRECTION = /\b(?:no[,]?\s+sorry|sorry[,]?\s+i mean|correction|make that)\b/i;
const SPOKEN_QUOTE_MARKER = /\b(?:open|start|begin|close|end)?\s*quote(?:s|d)?\b/i;
const SPOKEN_QUOTE_MARKER_GLOBAL = /\b(?:(?:open|start|begin|close|end)\s+)?quotes?\b/gi;
const WHOLE_OUTPUT_QUOTE_PAIRS = [
  ['"', '"'],
  ["“", "”"],
  ["'", "'"],
  ["‘", "’"],
];
const TECHNICAL_TOKEN_PATTERN = /[A-Za-z0-9]+(?:[._+:/\\-][A-Za-z0-9]+)+|[A-Za-z][A-Za-z0-9]*/g;
const TECHNICAL_CONTEXT_PATTERN =
  /\b([A-Za-z0-9][A-Za-z0-9._+:/\\-]*)\s+(?=(?:agent|file|folder|directory|model|identifier|id|path)\b)/gi;

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

const getOrderedBigramRetention = (originalWords, cleanedWords) => {
  if (originalWords.length < 2) return 1;

  const cleanedBigrams = new Map();
  for (let index = 0; index < cleanedWords.length - 1; index += 1) {
    const key = `${cleanedWords[index]}\u0000${cleanedWords[index + 1]}`;
    cleanedBigrams.set(key, (cleanedBigrams.get(key) || 0) + 1);
  }

  let retained = 0;
  for (let index = 0; index < originalWords.length - 1; index += 1) {
    const key = `${originalWords[index]}\u0000${originalWords[index + 1]}`;
    const available = cleanedBigrams.get(key) || 0;
    if (available > 0) {
      retained += 1;
      cleanedBigrams.set(key, available - 1);
    }
  }

  return retained / (originalWords.length - 1);
};

const getContentWords = (value) =>
  new Set(
    getWords(value).filter(
      (word) => word.length >= 3 && !CONTENT_STOP_WORDS.has(word) && !/^\d+$/.test(word)
    )
  );

const stemComparableWord = (word) => {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  for (const suffix of ["ingly", "edly", "ing", "ed", "es", "ly", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
};

const isEditDistanceAtMostOne = (left, right) => {
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left === right) return true;

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  if (leftIndex < left.length || rightIndex < right.length) edits += 1;
  return edits <= 1;
};

const areLikelyInflectionOrSpellingVariants = (left, right) =>
  stemComparableWord(left) === stemComparableWord(right) ||
  (left.length >= 5 && right.length >= 5 && isEditDistanceAtMostOne(left, right));

const getSemanticContentDiff = (originalWords, cleanedWords) => {
  const remainingOriginal = [...originalWords];
  const remainingCleaned = [...cleanedWords];

  for (let index = remainingOriginal.length - 1; index >= 0; index -= 1) {
    const exactIndex = remainingCleaned.indexOf(remainingOriginal[index]);
    if (exactIndex >= 0) {
      remainingOriginal.splice(index, 1);
      remainingCleaned.splice(exactIndex, 1);
    }
  }

  for (let index = remainingOriginal.length - 1; index >= 0; index -= 1) {
    const variantIndex = remainingCleaned.findIndex((candidate) =>
      areLikelyInflectionOrSpellingVariants(remainingOriginal[index], candidate)
    );
    if (variantIndex >= 0) {
      remainingOriginal.splice(index, 1);
      remainingCleaned.splice(variantIndex, 1);
    }
  }

  return {
    missingCount: remainingOriginal.length,
    addedCount: remainingCleaned.length,
  };
};

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

const tokenizeTechnicalText = (value) =>
  (String(value || "").match(TECHNICAL_TOKEN_PATTERN) || []).map((token) =>
    token.toLocaleLowerCase()
  );

const getProtectedTechnicalTokens = (value) => {
  const raw = String(value || "");
  const protectedTokens = new Set(
    (raw.match(TECHNICAL_TOKEN_PATTERN) || [])
      .filter(
        (token) =>
          /\d/.test(token) ||
          /[._+:/\\]/.test(token) ||
          (/^[A-Z][A-Z0-9]{1,}$/.test(token) && token.length >= 2)
      )
      .map((token) => token.toLocaleLowerCase())
  );

  for (const match of raw.matchAll(TECHNICAL_CONTEXT_PATTERN)) {
    const token = match[1]?.toLocaleLowerCase();
    if (token && !CONTENT_STOP_WORDS.has(token)) protectedTokens.add(token);
  }

  return protectedTokens;
};

const isWholeOutputQuoted = (value) => {
  const trimmed = String(value || "").trim();
  return WHOLE_OUTPUT_QUOTE_PAIRS.some(
    ([open, close]) =>
      trimmed.length > open.length + close.length &&
      trimmed.startsWith(open) &&
      trimmed.endsWith(close)
  );
};

const countSpokenQuoteMarkers = (value) =>
  (String(value || "").match(SPOKEN_QUOTE_MARKER_GLOBAL) || []).length;

const countQuotationGlyphs = (value) => {
  const characters = Array.from(String(value || ""));
  let count = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === '"' || character === "“" || character === "”" || character === "‘") {
      count += 1;
      continue;
    }
    if (character !== "'" && character !== "’") continue;

    const previousIsLetter = /\p{L}/u.test(characters[index - 1] || "");
    const nextIsLetter = /\p{L}/u.test(characters[index + 1] || "");
    if (!(previousIsLetter && nextIsLetter)) count += 1;
  }
  return count;
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
    isWholeOutputQuoted(cleaned) &&
    !isWholeOutputQuoted(original) &&
    !SPOKEN_QUOTE_MARKER.test(original)
  ) {
    reasons.push("added-whole-output-quotation");
  }

  const spokenQuoteMarkerCount = countSpokenQuoteMarkers(original);
  if (
    cleaned &&
    spokenQuoteMarkerCount >= 2 &&
    countQuotationGlyphs(cleaned) > spokenQuoteMarkerCount
  ) {
    reasons.push("nested-quotation-inference");
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

  const protectedTechnicalTokens = getProtectedTechnicalTokens(original);
  const cleanedTechnicalTokens = new Set(tokenizeTechnicalText(cleaned));
  const missingProtectedTechnicalTokens = [...protectedTechnicalTokens].filter(
    (token) => !cleanedTechnicalTokens.has(token)
  );
  if (missingProtectedTechnicalTokens.length > 0) {
    reasons.push("technical-token-change");
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

  const changedRelations = RELATION_MARKERS.filter(
    (marker) => countMarker(normalizedCleaned, marker) !== countMarker(normalizedOriginal, marker)
  );
  if (changedRelations.length > 0) {
    if (
      changedRelations.some(
        (marker) => countMarker(normalizedCleaned, marker) < countMarker(normalizedOriginal, marker)
      )
    ) {
      reasons.push("relation-marker-loss");
    }
    if (
      changedRelations.some(
        (marker) => countMarker(normalizedCleaned, marker) > countMarker(normalizedOriginal, marker)
      )
    ) {
      reasons.push("relation-marker-addition");
    }
  }

  if (original.includes("?") && !cleaned.includes("?")) {
    reasons.push("question-loss");
  }

  const originalContentWords = getContentWords(original);
  const cleanedContentWords = getContentWords(cleaned);
  const normalizedOriginalWords = getWords(original);
  const normalizedCleanedWords = getWords(cleaned);
  const orderedBigramRetention = getOrderedBigramRetention(
    normalizedOriginalWords,
    normalizedCleanedWords
  );
  let retainedContentWords = 0;
  for (const word of originalContentWords) {
    if (cleanedContentWords.has(word)) retainedContentWords += 1;
  }
  let retainedCleanedContentWords = 0;
  for (const word of cleanedContentWords) {
    if (originalContentWords.has(word)) retainedCleanedContentWords += 1;
  }
  const contentCoverage =
    originalContentWords.size > 0 ? retainedContentWords / originalContentWords.size : 1;
  const contentPrecision =
    cleanedContentWords.size > 0
      ? retainedCleanedContentWords / cleanedContentWords.size
      : originalContentWords.size === 0
        ? 1
        : 0;
  const missingContentWordCount = originalContentWords.size - retainedContentWords;
  const addedContentWordCount = cleanedContentWords.size - retainedCleanedContentWords;
  const semanticContentDiff = getSemanticContentDiff(originalContentWords, cleanedContentWords);
  if (originalWords >= 20 && contentCoverage < 0.6) {
    reasons.push("low-content-word-coverage");
  }
  if (
    originalWords >= 40 &&
    (contentCoverage < 0.9 ||
      orderedBigramRetention < 0.8 ||
      (!CLEAR_SELF_CORRECTION.test(original) &&
        originalWords >= 60 &&
        (semanticContentDiff.missingCount > 3 || semanticContentDiff.addedCount > 1)))
  ) {
    reasons.push("high-rewrite-risk");
  }

  return {
    accepted: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    metrics: {
      originalWords,
      cleanedWords,
      wordRatio,
      contentCoverage,
      contentPrecision,
      missingContentWordCount,
      addedContentWordCount,
      semanticMissingContentWordCount: semanticContentDiff.missingCount,
      semanticAddedContentWordCount: semanticContentDiff.addedCount,
      orderedBigramRetention,
      criticalTokenCount: criticalTokens.length,
      missingCriticalTokenCount: missingCriticalTokens.length,
      protectedTechnicalTokenCount: protectedTechnicalTokens.size,
      missingProtectedTechnicalTokenCount: missingProtectedTechnicalTokens.length,
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
