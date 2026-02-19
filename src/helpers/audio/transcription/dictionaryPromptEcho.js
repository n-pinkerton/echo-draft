/**
 * Heuristics to detect when a model likely echoed the custom dictionary prompt
 * instead of transcribing real speech (usually means silent/invalid audio).
 *
 * This file is intentionally pure and unit-testable.
 */

const normalizeEntry = (value) => String(value ?? "").trim();

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
  if (bulletLines.length >= 3) {
    return bulletLines.map((line) => line.replace(/^[-*•]\s+/, "").trim()).filter(Boolean);
  }

  if (trimmed.includes(",")) {
    return trimmed
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);
  }

  return lines;
}

/**
 * Returns true if the transcript appears to largely match the dictionary prompt.
 *
 * @param {string} transcribedText
 * @param {string[]} dictionaryEntries
 * @returns {boolean}
 */
export function isLikelyDictionaryPromptEcho(transcribedText, dictionaryEntries) {
  if (!shouldGuardDictionaryPromptEcho(dictionaryEntries)) {
    return false;
  }

  const dictionarySet = normalizeSet(dictionaryEntries);
  const transcriptTerms = extractTermsFromCommaOrBullets(transcribedText);
  const transcriptSet = normalizeSet(transcriptTerms);

  if (dictionarySet.size === 0 || transcriptSet.size === 0) {
    return false;
  }

  let intersection = 0;
  for (const term of dictionarySet) {
    if (transcriptSet.has(term)) {
      intersection += 1;
    }
  }

  const coverage = intersection / dictionarySet.size;
  const jaccard = intersection / (dictionarySet.size + transcriptSet.size - intersection);

  return coverage >= 0.95 && jaccard >= 0.9;
}

