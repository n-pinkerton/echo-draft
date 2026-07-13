const REQUEST_REASON_FRAGMENT =
  /^(?<request>(?:can|could|would|will)\s+you\b[^?]*?)\?\s+because\b/isu;
const CLEANED_REQUEST_AND_REASON_SENTENCES =
  /^(?<request>(?:can|could|would|will)\s+you\b[^?]*?)\?\s+(?<reason>[^?]+?)(?<ending>[.!])(?=\s+(?:also|and|but|can|could|finally|he|if|i|next|please|she|that|the|then|they|this|we|will|would|you)\b|\s*$)/isu;
const WHOLE_SPAN_SPOKEN_QUOTE_MARKERS =
  /^(?:(?:open|opening|begin|beginning|start)\s+(?:a\s+)?quote|quote)\b[\s\S]*\b(?:close|closing|end|ending)\s+(?:the\s+)?quote[.!?]?$/iu;
const AND_QUOTE_END_QUOTE_SPAN = /\band\s+quote\b[\s\S]*\bend\s+quote[.!?]?\s*$/iu;
const SOURCE_AND_QUOTE_END_QUOTE_SPAN =
  /^(?<lead>[\s\S]*?)\band\s+quote\b[\s\S]*\bend\s+quote[.!?]?\s*$/iu;
const GOVERNING_QUOTE_VERB =
  /\b(?:add|call|include|insert|label|mention|put|read|say|state|tell|type|use|write)\s*[,;:]?$/iu;
const DANGLING_QUOTED_CONJUNCTIONS = [
  /^(?<lead>[\s\S]+?),\s+and\s+(?<quote>\u201c[\s\S]*\u201d)(?<ending>[.!?]?)$/u,
  /^(?<lead>[\s\S]+?),\s+and\s+(?<quote>"[\s\S]*")(?<ending>[.!?]?)$/u,
];
const QUOTE_PAIRS = [
  ['"', '"'],
  ["\u201c", "\u201d"],
];

const countBecauseMarkers = (value) => String(value || "").match(/\bbecause\b/giu)?.length || 0;

const lowerSentenceStart = (value) =>
  value.replace(/^(\s*)(\p{Lu})(?=\p{Ll})/u, (_match, spacing, letter) => {
    return `${spacing}${letter.toLocaleLowerCase()}`;
  });

const hasWholeSpanQuoteGlyphs = (value) =>
  QUOTE_PAIRS.some(([open, close]) => value.startsWith(open) && value.endsWith(close));

/**
 * Remove one model-added pair of quotation marks around the entire cleanup.
 * Source quote glyphs and explicit whole-span spoken markers are authoritative;
 * internal attributed or contextual quotations are not affected.
 */
export function repairWholeOutputQuotationWrapper(originalText, cleanedText) {
  const original = typeof originalText === "string" ? originalText.trim() : "";
  const cleaned = typeof cleanedText === "string" ? cleanedText.trim() : "";
  const wrapper = QUOTE_PAIRS.find(
    ([open, close]) => cleaned.startsWith(open) && cleaned.endsWith(close)
  );

  if (!wrapper) return cleaned;
  if (hasWholeSpanQuoteGlyphs(original) || WHOLE_SPAN_SPOKEN_QUOTE_MARKERS.test(original)) {
    return cleaned;
  }

  const inner = cleaned.slice(wrapper[0].length, cleaned.length - wrapper[1].length);
  if (inner.includes(wrapper[0]) || inner.includes(wrapper[1])) return cleaned;

  return inner;
}

/**
 * Split a bare, explicitly dictated trailing quotation from the complete clause
 * that precedes it instead of leaving the quotation attached by a dangling "and".
 */
export function repairDanglingExplicitQuoteConjunction(originalText, cleanedText) {
  const original = typeof originalText === "string" ? originalText.trim() : "";
  const cleaned = typeof cleanedText === "string" ? cleanedText.trim() : "";
  if (!AND_QUOTE_END_QUOTE_SPAN.test(original)) return cleaned;

  const match = DANGLING_QUOTED_CONJUNCTIONS.map((pattern) => cleaned.match(pattern)).find(Boolean);
  if (!match?.groups?.lead || !match.groups.quote) return cleaned;
  const sourceLead = original.match(SOURCE_AND_QUOTE_END_QUOTE_SPAN)?.groups?.lead?.trim() || "";
  if (GOVERNING_QUOTE_VERB.test(sourceLead) || GOVERNING_QUOTE_VERB.test(match.groups.lead)) {
    return cleaned;
  }

  return `${match.groups.lead.trim()}. ${match.groups.quote}${match.groups.ending}`;
}

/**
 * Detect a cleanup that leaves an explicit spoken quotation dangling after a
 * governing verb. Splitting this shape into two sentences would corrupt the
 * verb's object, so the fidelity layer must retry or keep the original.
 */
export function hasGovernedExplicitQuoteAttachment(originalText, cleanedText) {
  const original = typeof originalText === "string" ? originalText.trim() : "";
  const cleaned = typeof cleanedText === "string" ? cleanedText.trim() : "";
  const sourceLead = original.match(SOURCE_AND_QUOTE_END_QUOTE_SPAN)?.groups?.lead?.trim() || "";
  if (!sourceLead || !GOVERNING_QUOTE_VERB.test(sourceLead)) return false;

  const cleanedMatch = DANGLING_QUOTED_CONJUNCTIONS.map((pattern) => cleaned.match(pattern)).find(
    Boolean
  );
  return Boolean(cleanedMatch?.groups?.lead && cleanedMatch.groups.quote);
}

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

export function repairCleanupOutput(originalText, cleanedText) {
  return repairRequestReasonFragment(
    originalText,
    repairDanglingExplicitQuoteConjunction(
      originalText,
      repairWholeOutputQuotationWrapper(originalText, cleanedText)
    )
  );
}

export default {
  hasGovernedExplicitQuoteAttachment,
  repairCleanupOutput,
  repairDanglingExplicitQuoteConjunction,
  repairRequestReasonFragment,
  repairWholeOutputQuotationWrapper,
};
