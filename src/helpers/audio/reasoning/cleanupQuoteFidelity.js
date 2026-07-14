const SPOKEN_QUOTE_MARKER_GLOBAL = /\b(?:(?:open|start|begin|close|end)\s+)?quotes?\b/gi;

const CONTEXTUAL_QUOTE_INTRODUCTION =
  "(?:the following|these next)\\s+(?:phrase|sentence|statement|text|words?)";
const CONTEXTUAL_QUOTE_EVIDENCE =
  "(?:dictat(?:ed|ion)|exact(?:ly)?|literal(?:ly)?|not\\s+an\\s+instruction|quot(?:e|ed)|verbatim)";

const normalizeQuoteSpan = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/[’‘]/gu, "'")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim();

export const countSpokenQuoteMarkers = (value) =>
  (String(value || "").match(SPOKEN_QUOTE_MARKER_GLOBAL) || []).length;

export const countQuotationGlyphs = (value) => {
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

const getContextuallyIntroducedSourceSentences = (value) =>
  Array.from(
    String(value || "").matchAll(
      new RegExp(
        `\\b${CONTEXTUAL_QUOTE_INTRODUCTION}\\b(?=[^.!?\\r\\n]{0,140}\\b${CONTEXTUAL_QUOTE_EVIDENCE}\\b)[^.!?\\r\\n]{0,180}[.!?]\\s*(?<sentence>[^.!?\\r\\n]{1,500}[.!?])`,
        "giu"
      )
    ),
    (match) => normalizeQuoteSpan(match.groups?.sentence || "")
  ).filter(Boolean);

const getContextuallyIntroducedOutputQuotes = (value) =>
  Array.from(
    String(value || "").matchAll(
      new RegExp(
        `\\b${CONTEXTUAL_QUOTE_INTRODUCTION}\\b(?=[^.!?\\r\\n]{0,140}\\b${CONTEXTUAL_QUOTE_EVIDENCE}\\b)[^.!?\\r\\n]{0,180}:\\s*(?:“(?<curly>[^”\\r\\n]{1,500})”|"(?<straight>[^"\\r\\n]{1,500})")`,
        "giu"
      )
    ),
    (match) => normalizeQuoteSpan(match.groups?.curly || match.groups?.straight || "")
  ).filter(Boolean);

const assessContextualQuotationPairs = (original, cleaned) => {
  const sourceSentences = getContextuallyIntroducedSourceSentences(original);
  const outputQuotes = getContextuallyIntroducedOutputQuotes(cleaned);
  let verifiedPairs = 0;
  let unverifiedPairs = 0;
  for (let index = 0; index < outputQuotes.length; index += 1) {
    if (outputQuotes[index] !== sourceSentences[index]) {
      unverifiedPairs += 1;
      continue;
    }
    verifiedPairs += 1;
  }
  return { unverifiedPairs, verifiedPairs };
};

export const countVerifiedContextualQuotationPairs = (original, cleaned) =>
  assessContextualQuotationPairs(original, cleaned).verifiedPairs;

export const countUnverifiedContextualQuotationPairs = (original, cleaned) =>
  assessContextualQuotationPairs(original, cleaned).unverifiedPairs;

export const getAppliedSpokenQuoteMarkerTexts = (original, cleaned) => {
  const markers = String(original || "").match(SPOKEN_QUOTE_MARKER_GLOBAL) || [];
  return markers.length >= 2 &&
    markers.length % 2 === 0 &&
    countQuotationGlyphs(cleaned) >= markers.length
    ? markers
    : [];
};

export const getSpokenQuoteAttachmentComparisonText = (original, cleaned) =>
  getAppliedSpokenQuoteMarkerTexts(original, cleaned).length >= 2
    ? String(original || "").replace(SPOKEN_QUOTE_MARKER_GLOBAL, " ")
    : original;

export default {
  countQuotationGlyphs,
  countSpokenQuoteMarkers,
  countUnverifiedContextualQuotationPairs,
  countVerifiedContextualQuotationPairs,
  getAppliedSpokenQuoteMarkerTexts,
  getSpokenQuoteAttachmentComparisonText,
};
