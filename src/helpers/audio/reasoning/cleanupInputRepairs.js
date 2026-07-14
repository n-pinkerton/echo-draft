const ATTRIBUTED_MISRECOGNIZED_END_QUOTE =
  /(?<attribution>\b(?:asked|said|says|wrote)\s*,?\s*)(?<opening>quote)(?<afterOpening>\s*,?\s*)(?<body>[^.!?\r\n\u2028\u2029]{3,500}?),\s*(?<closing>and\s*,\s*quote)\s*,(?=\s*first\b[^.!?\r\n\u2028\u2029]{1,300}[,;]\s*(?:and\s+)?second\b[^.!?\r\n\u2028\u2029]{1,300}[,;]\s*(?:and\s+)?third\b)/iu;

const countPlainQuoteMarkers = (value) => String(value || "").match(/\bquote\b/giu)?.length || 0;

/**
 * Return the one recognizer-artifact span that is safe to treat as a spoken
 * quote pair. Keeping the attribution, both markers, and the complete list in
 * one sentence prevents evidence from unrelated later prose authorizing it.
 */
export function getMisrecognizedSpokenQuoteBoundary(value) {
  const source = String(value || "");
  if (countPlainQuoteMarkers(source) !== 2) return null;
  const match = source.match(ATTRIBUTED_MISRECOGNIZED_END_QUOTE);
  if (!match?.groups || typeof match.index !== "number") return null;

  const openingStart = match.index + match.groups.attribution.length;
  const openingEnd = openingStart + match.groups.opening.length;
  const bodyStart = openingEnd + match.groups.afterOpening.length;
  const bodyEnd = bodyStart + match.groups.body.length;
  const closingOffset = match[0]
    .toLocaleLowerCase()
    .lastIndexOf(match.groups.closing.toLocaleLowerCase());
  const closingStart = match.index + closingOffset;

  return {
    body: match.groups.body,
    bodyEnd,
    bodyStart,
    closingEnd: closingStart + match.groups.closing.length,
    closingStart,
    closingText: match.groups.closing,
    match,
    openingEnd,
    openingStart,
    openingText: match.groups.opening,
  };
}

/**
 * Repair the narrow STT error where a dictated "end quote" becomes the
 * punctuated phrase "and, quote" before a new list item or clause. Requiring
 * one attributed opener, exactly two markers, and the unusual comma pattern
 * avoids treating ordinary mentions of two quotations as boundaries.
 */
export function repairMisrecognizedSpokenQuoteBoundary(value) {
  const source = String(value || "");
  if (!getMisrecognizedSpokenQuoteBoundary(source)) return source;
  return source.replace(
    ATTRIBUTED_MISRECOGNIZED_END_QUOTE,
    (_match, _attribution, _opening, _afterOpening, _body, _closing, _offset, _source, groups) =>
      `${groups.attribution}${groups.opening}${groups.afterOpening}${groups.body}, end quote,`
  );
}

export default { getMisrecognizedSpokenQuoteBoundary, repairMisrecognizedSpokenQuoteBoundary };
