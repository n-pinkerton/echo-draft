const ATTRIBUTED_MISRECOGNIZED_END_QUOTE =
  /(?<opening>\b(?:asked|said|says|wrote)\s*,?\s*quote\s*,?)(?<body>[\s\S]{3,500}?),\s*and\s*,\s*quote\s*,(?=\s*first\b)/iu;

const COMPLETE_SEQUENCED_LIST_AFTER_QUOTE =
  /,\s*and\s*,\s*quote\s*,\s*first\b[^.!?\r\n]{1,300}[,;]\s*(?:and\s+)?second\b[^.!?\r\n]{1,300}[,;]\s*(?:and\s+)?third\b/iu;

const countPlainQuoteMarkers = (value) => String(value || "").match(/\bquote\b/giu)?.length || 0;

/**
 * Repair the narrow STT error where a dictated "end quote" becomes the
 * punctuated phrase "and, quote" before a new list item or clause. Requiring
 * one attributed opener, exactly two markers, and the unusual comma pattern
 * avoids treating ordinary mentions of two quotations as boundaries.
 */
export function repairMisrecognizedSpokenQuoteBoundary(value) {
  const source = String(value || "");
  if (countPlainQuoteMarkers(source) !== 2) return source;
  if (!COMPLETE_SEQUENCED_LIST_AFTER_QUOTE.test(source)) return source;
  return source.replace(
    ATTRIBUTED_MISRECOGNIZED_END_QUOTE,
    (_match, opening, body) => `${opening}${body}, end quote,`
  );
}

export default { repairMisrecognizedSpokenQuoteBoundary };
