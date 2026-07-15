const SOURCE_AND_QUOTE_END_QUOTE_SPAN =
  /^(?<lead>[\s\S]*?)\band\s+quote\b[\s\S]*\bend\s+quote[.!?]?\s*$/iu;
const AND_QUOTE_END_QUOTE_SPAN = /\band\s+quote\b[\s\S]*\bend\s+quote[.!?]?\s*$/iu;
const GOVERNING_QUOTE_VERB =
  /\b(?:add|call|include|insert|label|mention|put|read|say|state|tell|type|use|write)\s*[,;:]?$/iu;
const DANGLING_QUOTED_CONJUNCTIONS = [
  /^(?<lead>[\s\S]+?),\s+and\s+(?<quote>\u201c[\s\S]*\u201d)(?<ending>[.!?]?)$/u,
  /^(?<lead>[\s\S]+?),\s+and\s+(?<quote>"[\s\S]*")(?<ending>[.!?]?)$/u,
];

/**
 * Reject a model result that detaches an explicitly dictated quotation from
 * the verb governing it. This function classifies output; it never rewrites it.
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

/** Reject a dangling "and" left behind when spoken quote markers are rendered. */
export function hasDanglingExplicitQuoteConjunction(originalText, cleanedText) {
  const original = typeof originalText === "string" ? originalText.trim() : "";
  const cleaned = typeof cleanedText === "string" ? cleanedText.trim() : "";
  if (!AND_QUOTE_END_QUOTE_SPAN.test(original)) return false;
  return DANGLING_QUOTED_CONJUNCTIONS.some((pattern) => pattern.test(cleaned));
}

export default { hasDanglingExplicitQuoteConjunction, hasGovernedExplicitQuoteAttachment };
