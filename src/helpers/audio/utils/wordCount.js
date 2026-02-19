/**
 * Counts words in a human-ish way for progress UI.
 * This is intentionally simple (split on whitespace) and should not be used
 * for billing/usage calculations.
 *
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  if (!text || typeof text !== "string") return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

