/**
 * Heuristics to detect when a model likely echoed the custom dictionary prompt
 * instead of transcribing real speech (usually means silent/invalid audio).
 *
 * This file is intentionally pure and unit-testable.
 */

const TRAILING_SENTENCE_PUNCTUATION = /[.!?;:。！？；：؟؛…]+$/u;
const LIST_SEPARATOR_PUNCTUATION = /[,，、،]+/gu;
const OUTER_QUOTE_PAIRS = [
  ['"', '"'],
  ["'", "'"],
  ["“", "”"],
  ["‘", "’"],
  ["«", "»"],
  ["‹", "›"],
  ["„", "“"],
  ["‚", "‘"],
  ["「", "」"],
  ["『", "』"],
];

const stripMatchingOuterQuotes = (value) => {
  for (const [open, close] of OUTER_QUOTE_PAIRS) {
    if (value.startsWith(open) && value.endsWith(close) && value.length > open.length + close.length) {
      return value.slice(open.length, -close.length).trim();
    }
  }
  return value;
};

const stripPresentationBoundaries = (value) => {
  let normalized = value.replace(TRAILING_SENTENCE_PUNCTUATION, "").trim();
  normalized = stripMatchingOuterQuotes(normalized);
  return normalized.replace(TRAILING_SENTENCE_PUNCTUATION, "").trim();
};

const normalizeEntry = (value) =>
  stripPresentationBoundaries(
    String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ")
  );

const normalizeSet = (entries = []) =>
  new Set(
    entries
      .map(normalizeEntry)
      .filter(Boolean)
      .map((entry) => entry.toLowerCase())
  );

/**
 * Avoid false positives for tiny dictionaries (someone might actually dictate 2-3 terms).
 *
 * @param {string[]} dictionaryEntries
 * @returns {boolean}
 */
export function shouldGuardDictionaryPromptEcho(dictionaryEntries) {
  if (!Array.isArray(dictionaryEntries)) return false;
  return normalizeSet(dictionaryEntries).size >= 10;
}

/**
 * Extract terms from a transcript that may be comma-separated or bullet-based.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractTermsFromCommaOrBullets(text) {
  const raw = typeof text === "string" ? text : "";
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const bulletLines = lines.filter((line) => /^[-*•]\s+/.test(line));
  if (bulletLines.length >= 3 || (bulletLines.length > 0 && bulletLines.length === lines.length)) {
    return bulletLines.map((line) => line.replace(/^[-*•]\s+/, "").trim()).filter(Boolean);
  }

  if (/[,，、،]/u.test(trimmed)) {
    return trimmed
      .split(/[,，、،]/u)
      .map((term) => term.trim())
      .filter(Boolean);
  }

  return lines;
}

/**
 * Classifies whether the transcript appears to match the dictionary prompt.
 *
 * @param {string} transcribedText
 * @param {string[]} dictionaryEntries
 * @returns {"none"|"exact-short"|"likely"}
 */
export function classifyDictionaryPromptEcho(transcribedText, dictionaryEntries) {
  const dictionarySet = normalizeSet(dictionaryEntries);
  const transcriptTerms = extractTermsFromCommaOrBullets(transcribedText);
  const transcriptSet = normalizeSet(transcriptTerms);

  if (dictionarySet.size === 0 || transcriptSet.size === 0) {
    return "none";
  }

  // An exact dictionary-only echo can occur with even a single prompt term. Reject it at every
  // dictionary size: unlike a real sentence that merely contains a preferred term, it has no
  // words outside the normalized dictionary prompt. Keep the size threshold below for fuzzy
  // matching so short, partially overlapping dictation is not discarded.
  if (
    transcriptTerms.length === dictionarySet.size &&
    transcriptSet.size === dictionarySet.size &&
    [...dictionarySet].every((term) => transcriptSet.has(term))
  ) {
    return shouldGuardDictionaryPromptEcho(dictionaryEntries) ? "likely" : "exact-short";
  }

  if (!shouldGuardDictionaryPromptEcho(dictionaryEntries)) {
    return "none";
  }

  let intersection = 0;
  for (const term of dictionarySet) {
    if (transcriptSet.has(term)) {
      intersection += 1;
    }
  }

  const coverage = intersection / dictionarySet.size;
  const jaccard = intersection / (dictionarySet.size + transcriptSet.size - intersection);

  return coverage >= 0.95 && jaccard >= 0.9 ? "likely" : "none";
}

/**
 * Returns true if the transcript appears to largely match the dictionary prompt.
 *
 * @param {string} transcribedText
 * @param {string[]} dictionaryEntries
 * @returns {boolean}
 */
export function isLikelyDictionaryPromptEcho(transcribedText, dictionaryEntries) {
  return classifyDictionaryPromptEcho(transcribedText, dictionaryEntries) !== "none";
}

/**
 * Compare two local transcription passes while ignoring presentational punctuation/case.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeTranscriptionForComparison(value) {
  const normalized = stripPresentationBoundaries(
    String(value ?? "").normalize("NFKC").trim()
  );
  return normalized
    .toLowerCase()
    .replace(LIST_SEPARATOR_PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
export function areTranscriptionsEquivalent(left, right) {
  const normalizedLeft = normalizeTranscriptionForComparison(left);
  return normalizedLeft.length > 0 && normalizedLeft === normalizeTranscriptionForComparison(right);
}

