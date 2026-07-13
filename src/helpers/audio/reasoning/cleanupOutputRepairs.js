const REQUEST_REASON_FRAGMENT =
  /^(?<request>(?:can|could|would|will)\s+you\b[^?]*?)\?\s+because\b/isu;
const CLEANED_REQUEST_AND_REASON_SENTENCES =
  /^(?<request>(?:can|could|would|will)\s+you\b[^?]*?)\?\s+(?<reason>[^?]+?)(?<ending>[.!])(?=\s+(?:also|and|but|can|could|finally|he|if|i|next|please|she|that|the|then|they|this|we|will|would|you)\b|\s*$)/isu;

const countBecauseMarkers = (value) => String(value || "").match(/\bbecause\b/giu)?.length || 0;

const lowerSentenceStart = (value) =>
  value.replace(/^(\s*)(\p{Lu})(?=\p{Ll})/u, (_match, spacing, letter) => {
    return `${spacing}${letter.toLocaleLowerCase()}`;
  });

/**
 * Preserve an explicitly dictated reason while repairing the narrow fragment form
 * "Can you ...? Because ... ." Models often fix its grammar by deleting "because",
 * which loses the causal relationship. An explicit grammatical bridge keeps the
 * relationship and question without changing what the reason applies to.
 */
export function repairRequestReasonFragment(originalText, cleanedText) {
  const original = typeof originalText === "string" ? originalText.trim() : "";
  const cleaned = typeof cleanedText === "string" ? cleanedText.trim() : "";
  if (!REQUEST_REASON_FRAGMENT.test(original)) return cleaned;
  if (countBecauseMarkers(cleaned) >= countBecauseMarkers(original)) return cleaned;

  const match = cleaned.match(CLEANED_REQUEST_AND_REASON_SENTENCES);
  if (!match?.groups?.request || !match.groups.reason) return cleaned;

  const reason = lowerSentenceStart(match.groups.reason.trim());
  const repaired = `${match.groups.request}? I am asking because ${reason}${match.groups.ending}`;
  return `${repaired}${cleaned.slice(match[0].length)}`;
}

export default { repairRequestReasonFragment };
