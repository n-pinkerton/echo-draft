const ATTRIBUTED_MISRECOGNIZED_END_QUOTE =
  /(?<attribution>\b(?:asked|said|says|wrote)\s*,?\s*)(?<opening>quote)(?<afterOpening>\s*,?\s*)(?<body>[^.!?\r\n\u2028\u2029]{3,500}?),\s*(?<closing>and\s*,\s*quote)\s*,(?=\s*first\b[^.!?\r\n\u2028\u2029]{1,300}[,;]\s*(?:and\s+)?second\b[^.!?\r\n\u2028\u2029]{1,300}[,;]\s*(?:and\s+)?third\b)/iu;

const countPlainQuoteMarkers = (value) => String(value || "").match(/\bquote\b/giu)?.length || 0;

/**
 * Identify a narrow STT quote-marker shape for fidelity comparison only. The
 * source is never rewritten; the cleanup model decides how to punctuate it.
 */
function getMisrecognizedSpokenQuoteBoundary(value) {
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

// Only singular "quote" is a spoken boundary marker. Plural "quotes" is an
// ordinary noun and must never authorize deleting source text.
const SPOKEN_QUOTE_MARKER_GLOBAL = /\b(?:(?<qualifier>open|start|begin|close|end)\s+)?quote\b/giu;

const CONTEXTUAL_QUOTE_INTRODUCTION =
  /\b(?:the following|these next)\s+(?:phrase|sentence|statement|text|words?)\b/giu;
const CONTEXTUAL_QUOTE_EVIDENCE =
  /\b(?:dictat(?:ed|ion)|exact(?:ly)?|literal(?:ly)?|not\s+an\s+instruction|quot(?:e|ed)|verbatim)\b/iu;
const GOVERNED_DIRECT_SPEECH =
  /\b(?<verb>ask|asked|said|says)\s*,?\s+(?<body>[^.!?\r\n\u2028\u2029]{2,500}?)(?=\s+\b(?:and\s+then|because|but|then)\b|[.!?\u2028\u2029]|$)/giu;
const GOVERNED_INDIRECT_QUESTION =
  /\bask(?:ed)?\s+(?:me\s+)?whether\s+(?<body>[^.!?\r\n\u2028\u2029]{2,500})[.!?]?/giu;
const STANDALONE_ABBREVIATION_CHAIN =
  /^(?:(?:dr|e\.g|etc|i\.e|jr|mr|mrs|ms|prof|sr|st|vs|[a-z])\.\s*)+$/iu;
const QUOTE_LINE_BOUNDARY = /[\r\n\u2028\u2029]/u;
const DIRECT_QUESTION_OPENER =
  /^(?:am|are|can|could|did|do|does|had|has|have|how|is|may|might|should|was|were|what|when|where|which|who|why|will|would)\b/iu;
const DIRECT_SPEECH_OPENER =
  /^(?:(?:do\s+not|don't|please)\s+)?(?:add|ask|call|check|confirm|delete|do|hold|keep|make|no|preserve|publish|remember|retain|send|stop|use|wait|write|yes)\b/iu;
const METALINGUISTIC_SPEECH_NOUNS = new Set([
  "data",
  "literal",
  "literals",
  "phrase",
  "phrases",
  "term",
  "terms",
  "text",
  "token",
  "tokens",
  "word",
  "words",
]);
const METALINGUISTIC_NAMING_WORDS = new Set([
  "call",
  "called",
  "label",
  "labeled",
  "labelled",
  "name",
  "named",
]);
const METALINGUISTIC_NAMING_MODIFIERS = new Set([
  "actually",
  "almost",
  "directly",
  "enough",
  "even",
  "exactly",
  "explicitly",
  "far",
  "just",
  "least",
  "less",
  "literally",
  "more",
  "most",
  "much",
  "precisely",
  "pretty",
  "quite",
  "rather",
  "simply",
  "so",
  "somewhat",
  "specifically",
  "too",
  "very",
]);
const METALINGUISTIC_NAMING_CONNECTORS = new Set([
  "also",
  "along",
  "and",
  "as",
  "both",
  "but",
  "either",
  "neither",
  "nor",
  "not",
  "only",
  "or",
  "together",
  "well",
  "with",
]);
const METALINGUISTIC_NAMING_TAIL =
  /(?:\b(?:label|name)\s+(?:is|was)|\b(?:identified|known)\b.*\bas|\breferred\b.*\bto\s+as)$/u;
const METALINGUISTIC_QUOTE_CONTROL_TAIL =
  /(?:^|\s)(?:is|are|was|were)\s+(?:(?:please|to)\s+)?(?:dictate|say|type)$/u;
const POSSESSIVE_HEAD_WORDS = new Set([
  "account",
  "analysis",
  "approach",
  "budget",
  "calendar",
  "call",
  "comments",
  "copy",
  "decision",
  "decisions",
  "document",
  "documents",
  "draft",
  "email",
  "feedback",
  "figures",
  "meeting",
  "message",
  "name",
  "names",
  "notes",
  "plan",
  "plans",
  "proposal",
  "report",
  "reports",
  "review",
  "role",
  "schedule",
  "team",
  "work",
]);
const QUOTE_ANCHOR_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "begin",
  "close",
  "end",
  "for",
  "from",
  "in",
  "of",
  "on",
  "open",
  "or",
  "quote",
  "quotes",
  "start",
  "the",
  "then",
  "to",
  "with",
]);

const isLetterOrNumber = (value) => /[\p{L}\p{N}]/u.test(value || "");

const normalizeQuoteWords = (value) =>
  (
    String(value || "")
      .normalize("NFKC")
      .replace(/[’‘ʼ]/gu, "'")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) || []
  ).join(" ");

/**
 * Reject apparent speech verbs that are themselves being stored as literal
 * text. Limit the check to the current clause so an earlier mention of a token
 * cannot suppress genuine speech attribution in a later sentence.
 */
const hasMetalinguisticSpeechPrefix = (value) => {
  const raw = String(value || "");
  const clauseStart = Math.max(
    raw.lastIndexOf("."),
    raw.lastIndexOf("!"),
    raw.lastIndexOf("?"),
    raw.lastIndexOf(";"),
    raw.lastIndexOf("\r"),
    raw.lastIndexOf("\n"),
    raw.lastIndexOf("\u2028"),
    raw.lastIndexOf("\u2029")
  );
  const lexicalWords =
    raw.slice(clauseStart + 1).match(/[\p{L}\p{N}]+(?:['’‘ʼ][\p{L}\p{N}]+)*/gu) || [];
  const words = lexicalWords.map((word) => normalizeQuoteWords(word));
  const nounIndex = words.findLastIndex((word) =>
    METALINGUISTIC_SPEECH_NOUNS.has(word.endsWith("'s") ? word.slice(0, -2) : word)
  );
  if (nounIndex < 0) return false;

  const trailing = words.slice(nounIndex + 1);
  const lexicalTrailing = lexicalWords.slice(nounIndex + 1);
  if (trailing.length === 0) return true;
  // In "the token our parser explicitly named said", the naming word governs
  // the apparent speech verb because it is the final lexical word before it.
  // A later subject ("the token named Alpha, then Morgan said ...") keeps
  // genuine attribution eligible even though both clauses share a sentence.
  const hasTerminalNamingTail = (candidate) =>
    METALINGUISTIC_NAMING_WORDS.has(candidate.at(-1)) ||
    METALINGUISTIC_NAMING_TAIL.test(candidate.join(" "));
  if (hasTerminalNamingTail(trailing)) return true;
  if (METALINGUISTIC_QUOTE_CONTROL_TAIL.test(trailing.join(" "))) return true;

  // Lower-case modifier chains after a complete naming grammar are adverbial
  // emphasis ("whose name is officially and formally said"). Preserve
  // capitalised names such as Emily as possible later speakers.
  const isModifierChain = (candidate, lexicalCandidate) => {
    if (
      candidate.length === 0 ||
      lexicalCandidate.some((word) => word !== word.toLocaleLowerCase())
    ) {
      return false;
    }
    const isModifier = (word) => METALINGUISTIC_NAMING_MODIFIERS.has(word) || /ly$/u.test(word);
    const isConnector = (word, index) =>
      METALINGUISTIC_NAMING_CONNECTORS.has(word) ||
      (word === "whether" && candidate.slice(index + 1).includes("or"));
    if (candidate.every((word, index) => isConnector(word, index) || isModifier(word))) {
      return true;
    }

    // Permit an otherwise unknown multiword coordinator only when recognised
    // modifiers bound both sides. This covers "officially in addition to
    // formally" without treating a trailing ordinary speaker phrase as a
    // removable naming modifier.
    const modifierIndexes = candidate.flatMap((word, index) => (isModifier(word) ? [index] : []));
    if (modifierIndexes.length < 2) return false;
    const firstModifier = modifierIndexes[0];
    const lastModifier = modifierIndexes.at(-1);
    return candidate.every(
      (word, index) => (index >= firstModifier && index <= lastModifier) || isConnector(word, index)
    );
  };
  for (let split = 0; split < trailing.length; split += 1) {
    if (split > 0 && !hasTerminalNamingTail(trailing.slice(0, split))) continue;
    if (isModifierChain(trailing.slice(split), lexicalTrailing.slice(split))) return true;
  }
  return false;
};

const getQuoteLexicalTokens = (value) =>
  Array.from(String(value || "").matchAll(/[\p{L}\p{N}]+(?:['’‘ʼ][\p{L}\p{N}]+)*/gu), (match) => ({
    end: (match.index || 0) + match[0].length,
    start: match.index || 0,
    value: normalizeQuoteWords(match[0]),
  }));

const QUOTE_CONTRACTION_EXPANSIONS = new Map([
  ["aren't", ["are", "not"]],
  ["can't", ["can", "not"]],
  ["couldn't", ["could", "not"]],
  ["didn't", ["did", "not"]],
  ["doesn't", ["does", "not"]],
  ["don't", ["do", "not"]],
  ["hadn't", ["had", "not"]],
  ["hasn't", ["has", "not"]],
  ["haven't", ["have", "not"]],
  ["i'm", ["i", "am"]],
  ["isn't", ["is", "not"]],
  ["shouldn't", ["should", "not"]],
  ["they're", ["they", "are"]],
  ["wasn't", ["was", "not"]],
  ["we're", ["we", "are"]],
  ["weren't", ["were", "not"]],
  ["won't", ["will", "not"]],
  ["wouldn't", ["would", "not"]],
  ["you're", ["you", "are"]],
]);
const SAFE_QUOTE_GRAMMAR_INSERTIONS = new Set(["a", "an", "the"]);
const SAFE_QUOTE_SPEECH_ARTIFACT_DELETIONS = new Set([
  "ah",
  "eh",
  "er",
  "erm",
  "hm",
  "hmm",
  "uh",
  "um",
]);
const SAFE_QUOTE_GRAMMAR_SUBSTITUTION_GROUPS = [
  new Set(["a", "an"]),
  new Set(["am", "are", "is"]),
  new Set(["has", "have"]),
  new Set(["was", "were"]),
];

const getQuoteComparisonTokens = (value) =>
  getQuoteLexicalTokens(value).flatMap((token) => {
    const expansion = QUOTE_CONTRACTION_EXPANSIONS.get(token.value);
    return (expansion || [token.value]).map((word) => ({ ...token, value: word }));
  });

const isSafeQuoteGrammarSubstitution = (sourceWord, outputWord) =>
  SAFE_QUOTE_GRAMMAR_SUBSTITUTION_GROUPS.some(
    (group) => group.has(sourceWord) && group.has(outputWord)
  );

const isSafeQuoteGrammarInsertion = (_sourceTokens, _sourceIndex, outputWord) =>
  SAFE_QUOTE_GRAMMAR_INSERTIONS.has(outputWord);

/**
 * Match a cleaned quote body to the beginning of an unclosed spoken quote.
 * The first token and all substantive or relationship-bearing words stay
 * exact. A narrow, banded edit budget permits contraction equivalence, article
 * insertion, agreement repair, and explicit hesitation removal without
 * allowing actor, ownership, polarity, modality, or content substitutions.
 */
const getSpokenQuotePrefixAlignment = (sourceTokens, outputWords) => {
  if (outputWords.length === 0 || sourceTokens.length === 0) return null;
  if (sourceTokens[0].value !== outputWords[0]) return null;

  const maxEdits = Math.min(4, Math.max(1, Math.ceil(outputWords.length * 0.08)));
  const minimumSourceLength = Math.max(1, outputWords.length - maxEdits);
  const maximumSourceLength = Math.min(sourceTokens.length, outputWords.length + maxEdits);
  if (minimumSourceLength > maximumSourceLength) return null;

  let previous = new Map([[0, 0]]);
  for (
    let outputIndex = 1;
    outputIndex <= Math.min(outputWords.length, maxEdits);
    outputIndex += 1
  ) {
    const insertionCost = isSafeQuoteGrammarInsertion(sourceTokens, 0, outputWords[outputIndex - 1])
      ? 1
      : Number.POSITIVE_INFINITY;
    previous.set(
      outputIndex,
      (previous.get(outputIndex - 1) ?? Number.POSITIVE_INFINITY) + insertionCost
    );
  }

  let best = null;
  for (let sourceIndex = 1; sourceIndex <= maximumSourceLength; sourceIndex += 1) {
    const current = new Map();
    const sourceWord = sourceTokens[sourceIndex - 1].value;
    if (sourceIndex <= maxEdits) {
      const deletionCost = SAFE_QUOTE_SPEECH_ARTIFACT_DELETIONS.has(sourceWord)
        ? 1
        : Number.POSITIVE_INFINITY;
      current.set(0, (previous.get(0) ?? Number.POSITIVE_INFINITY) + deletionCost);
    }
    let rowMinimum = current.get(0) ?? Number.POSITIVE_INFINITY;

    const minimumOutputIndex = Math.max(1, sourceIndex - maxEdits);
    const maximumOutputIndex = Math.min(outputWords.length, sourceIndex + maxEdits);
    for (
      let outputIndex = minimumOutputIndex;
      outputIndex <= maximumOutputIndex;
      outputIndex += 1
    ) {
      const outputWord = outputWords[outputIndex - 1];
      const deletionCost = SAFE_QUOTE_SPEECH_ARTIFACT_DELETIONS.has(sourceWord)
        ? 1
        : Number.POSITIVE_INFINITY;
      const insertionCost = isSafeQuoteGrammarInsertion(sourceTokens, sourceIndex, outputWord)
        ? 1
        : Number.POSITIVE_INFINITY;
      const substitutionCost =
        sourceWord === outputWord
          ? 0
          : isSafeQuoteGrammarSubstitution(sourceWord, outputWord)
            ? 1
            : Number.POSITIVE_INFINITY;
      const distance = Math.min(
        (previous.get(outputIndex) ?? Number.POSITIVE_INFINITY) + deletionCost,
        (current.get(outputIndex - 1) ?? Number.POSITIVE_INFINITY) + insertionCost,
        (previous.get(outputIndex - 1) ?? Number.POSITIVE_INFINITY) + substitutionCost
      );
      current.set(outputIndex, distance);
      rowMinimum = Math.min(rowMinimum, distance);
    }
    previous = current;

    if (rowMinimum > maxEdits) break;

    if (sourceIndex < minimumSourceLength) continue;
    const distance = current.get(outputWords.length) ?? Number.POSITIVE_INFINITY;
    if (!best || distance < best.distance) {
      best = { distance, maxEdits, sourceTokenCount: sourceIndex };
    }
  }

  return best && best.distance <= best.maxEdits ? best : null;
};

const getTokenValueOccurrenceIndexAt = (value, tokenValue, targetStart, excludedRanges = []) => {
  let occurrenceIndex = 0;
  for (const token of getQuoteComparisonTokens(value)) {
    if (excludedRanges.some((range) => token.start < range.end && range.start < token.end)) {
      continue;
    }
    if (token.value !== tokenValue) continue;
    if (token.start === targetStart) return occurrenceIndex;
    if (token.start > targetStart) break;
    occurrenceIndex += 1;
  }
  return -1;
};

/**
 * Identify which occurrence of a repeated phrase occupies a quote span. Local
 * neighbours alone can collide (for example, two "Morgan said ... before"
 * clauses), so location-bound quote evidence also follows the phrase ordinal.
 */
const getQuoteBodyOccurrenceIndex = (value, body, rangeStart, rangeEnd) => {
  const targetWords = normalizeQuoteWords(body).split(/\s+/u).filter(Boolean);
  if (targetWords.length === 0) return null;
  const tokens = getQuoteLexicalTokens(value);
  const occurrences = [];
  for (let index = 0; index <= tokens.length - targetWords.length; index += 1) {
    if (!targetWords.every((word, offset) => tokens[index + offset]?.value === word)) {
      continue;
    }
    occurrences.push({
      end: tokens[index + targetWords.length - 1].end,
      start: tokens[index].start,
    });
  }
  return occurrences.findIndex(
    (occurrence) => occurrence.start >= rangeStart && occurrence.end <= rangeEnd
  );
};

const getQuoteAnchorWords = (value) =>
  normalizeQuoteWords(value)
    .split(/\s+/u)
    .filter((word) => word && !QUOTE_ANCHOR_STOP_WORDS.has(word));

const getLeftQuoteAnchor = (value, index) =>
  getQuoteAnchorWords(String(value || "").slice(Math.max(0, index - 160), index)).at(-1) || "";

const getRightQuoteAnchor = (value, index) =>
  getQuoteAnchorWords(String(value || "").slice(index, index + 160))[0] || "";

const normalizeExactQuoteSpan = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/[’‘ʼ]/gu, "'")
    .toLocaleLowerCase()
    .replace(/\b(\d{1,2}:\d{2})\s*([ap])\.?\s*m\.?\b/giu, "$1$2m")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .replace(/([([{])\s+/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();

const collectPairedQuotes = (value, opening, closing, { standalone = false } = {}) => {
  const raw = String(value || "");
  const pairs = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(opening, cursor);
    if (start < 0) break;
    if (standalone && isLetterOrNumber(raw[start - 1])) {
      cursor = start + opening.length;
      continue;
    }

    let end = raw.indexOf(closing, start + opening.length);
    while (
      end >= 0 &&
      standalone &&
      isLetterOrNumber(raw[end - 1]) &&
      isLetterOrNumber(raw[end + closing.length])
    ) {
      end = raw.indexOf(closing, end + closing.length);
    }
    if (end < 0) {
      cursor = start + opening.length;
      continue;
    }

    pairs.push({
      body: raw.slice(start + opening.length, end),
      bodyEnd: end,
      bodyStart: start + opening.length,
      end: end + closing.length,
      start,
    });
    cursor = end + closing.length;
  }
  return pairs;
};

const extractQuotationPairs = (value) =>
  [
    ...collectPairedQuotes(value, "“", "”"),
    ...collectPairedQuotes(value, '"', '"'),
    ...collectPairedQuotes(value, "‘", "’", { standalone: true }),
    ...collectPairedQuotes(value, "'", "'", { standalone: true }),
  ].sort((left, right) => left.start - right.start || right.end - left.end);

const getUnpairedQuotationGlyphs = (value, pairs) => {
  const raw = String(value || "");
  const pairedIndexes = new Set(
    pairs.flatMap((pair) => [pair.start, Math.max(pair.start, pair.end - 1)])
  );
  const unpaired = [];
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (!['"', "'", "‘", "’", "“", "”"].includes(character)) continue;
    if (pairedIndexes.has(index)) continue;
    if (character === "'" || character === "’") {
      const previousIsWord = isLetterOrNumber(raw[index - 1]);
      const nextIsWord = isLetterOrNumber(raw[index + 1]);
      if (previousIsWord && nextIsWord) {
        continue;
      }
      const previousWord = raw.slice(0, index).match(/[\p{L}\p{N}]+$/u)?.[0] || "";
      const nextWord = raw
        .slice(index + 1)
        .match(/^[^\p{L}\p{N}]*([\p{L}\p{N}]+)/u)?.[1]
        ?.toLocaleLowerCase();
      if (
        previousIsWord &&
        /s$/iu.test(previousWord) &&
        POSSESSIVE_HEAD_WORDS.has(nextWord || "")
      ) {
        continue;
      }
    }
    const left = normalizeQuoteWords(raw.slice(Math.max(0, index - 80), index))
      .split(/\s+/u)
      .filter(Boolean)
      .at(-1);
    const right = normalizeQuoteWords(raw.slice(index + 1, index + 81))
      .split(/\s+/u)
      .filter(Boolean)[0];
    unpaired.push({
      kind: ['"', "“", "”"].includes(character) ? "double" : "single",
      left: left || "",
      right: right || "",
    });
  }
  return unpaired;
};

const getPairExactText = (pair, value) => {
  const body = String(pair?.body || "");
  if (/[,.!?]\s*$/u.test(body)) return body;
  const trailing = String(value || "")
    .slice(pair?.end || 0)
    .match(/^\s*([,.!?])/u)?.[1];
  return trailing ? `${body}${trailing}` : body;
};

const segmentSentences = (value) => {
  const raw = String(value || "");
  let segments;
  try {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    segments = Array.from(segmenter.segment(raw), (segment) => ({
      end: segment.index + segment.segment.length,
      start: segment.index,
      text: segment.segment,
    }));
  } catch {
    segments = Array.from(raw.matchAll(/[^.!?\r\n]+(?:[.!?]+|$)/gu), (match) => ({
      end: (match.index || 0) + match[0].length,
      start: match.index || 0,
      text: match[0],
    }));
  }

  const merged = [];
  for (let index = 0; index < segments.length; index += 1) {
    let current = segments[index];
    while (STANDALONE_ABBREVIATION_CHAIN.test(current.text.trim()) && index + 1 < segments.length) {
      const next = segments[(index += 1)];
      current = {
        end: next.end,
        start: current.start,
        text: raw.slice(current.start, next.end),
      };
    }
    merged.push(current);
  }
  return merged;
};

const getContextualSourceOccurrences = (value) => {
  const raw = String(value || "");
  const sentences = segmentSentences(raw);
  const occurrences = [];
  for (const match of raw.matchAll(CONTEXTUAL_QUOTE_INTRODUCTION)) {
    const introductionIndex = sentences.findIndex(
      (sentence) => sentence.start <= (match.index || 0) && (match.index || 0) < sentence.end
    );
    if (introductionIndex < 0 || introductionIndex + 1 >= sentences.length) continue;
    if (!CONTEXTUAL_QUOTE_EVIDENCE.test(sentences[introductionIndex].text)) continue;
    const sentence = sentences[introductionIndex + 1];
    occurrences.push({
      contextIndex: occurrences.length,
      introductionEnd: (match.index || 0) + match[0].length,
      introductionStart: match.index || 0,
      sentenceEnd: sentence.end,
      sentenceStart: sentence.start,
      sentenceText: sentence.text.trim(),
    });
  }
  return occurrences;
};

const getContextualOutputOccurrences = (value) => {
  const raw = String(value || "");
  const matches = Array.from(raw.matchAll(CONTEXTUAL_QUOTE_INTRODUCTION));
  const occurrences = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index || 0;
    const nextStart = matches[index + 1]?.index ?? raw.length;
    if (!CONTEXTUAL_QUOTE_EVIDENCE.test(raw.slice(start, nextStart))) continue;
    occurrences.push({
      contextIndex: occurrences.length,
      introductionEnd: start + match[0].length,
      introductionStart: start,
    });
  }
  return occurrences;
};

const getOutputContextIndex = (pair, value, occurrences) => {
  for (let index = 0; index < occurrences.length; index += 1) {
    const occurrence = occurrences[index];
    const nextStart = occurrences[index + 1]?.introductionStart ?? Number.POSITIVE_INFINITY;
    if (
      pair.start < occurrence.introductionEnd ||
      pair.start >= nextStart ||
      pair.start - occurrence.introductionEnd > 600
    ) {
      continue;
    }
    if (
      CONTEXTUAL_QUOTE_EVIDENCE.test(
        String(value || "").slice(occurrence.introductionStart, pair.start)
      )
    ) {
      return occurrence.contextIndex;
    }
  }
  return null;
};

const MAX_UNCLOSED_SPOKEN_QUOTE_OPENERS = 32;
// A normal dictation contains very few spoken quote markers. Above this bound,
// treat every marker as literal text and authorize no model-added quotation
// glyphs. This keeps corrupted/adversarial transcripts cheap and fail-closed.
const MAX_SPOKEN_QUOTE_MARKERS = 256;
const SPOKEN_QUOTE_STRONG_ATTRIBUTION_CONTEXT =
  /\b(?:repl(?:y|ied|ies)|say|said|says|whisper(?:ed|s)?)\s*[,;:]?\s+$/iu;
const SPOKEN_QUOTE_BODY_SUPPORTED_CONTEXT =
  /\b(?:ask(?:ed)?|dictate(?:d)?|read|state(?:d|s)?|type|write|wrote)\s+$/iu;
const SPOKEN_QUOTE_DELIMITER_CONTEXT = /[.!?,;:]\s*$/u;
const LIKELY_LITERAL_QUOTE_TAIL =
  /^\s+(?:(?:am|are|is|means?|refers?|represents?|was|were)\b|(?:access|button|command|control|menu|mode|option|setting|settings|shortcut|style|toggle|typography)\b)/iu;
const ATTRIBUTED_SPEECH_BODY =
  /^[\p{L}\p{N}'’‘ʼ-]+(?:\s+[\p{L}\p{N}'’‘ʼ-]+){0,3}\s+(?:ask(?:ed|s)?|repl(?:y|ied|ies)|said|says|state(?:d|s)?|whisper(?:ed|s)?|wrote)\b/iu;

const hasLikelyStandaloneSpokenQuoteBody = (raw, markerEnd) => {
  const body = raw.slice(markerEnd, markerEnd + 160).replace(/^\s*[,;:]?\s*/u, "");
  return (
    DIRECT_QUESTION_OPENER.test(body) ||
    DIRECT_SPEECH_OPENER.test(body) ||
    ATTRIBUTED_SPEECH_BODY.test(body) ||
    /^(?:a|after|an|before|during|for|from|hello|hey|hi|i|if|in|it|on|once|she|that|the|these|they|this|those|we|when|while|with|without|you)\b/iu.test(
      body
    )
  );
};

const hasStrongSpokenQuoteAttributionContext = (raw, start) =>
  SPOKEN_QUOTE_STRONG_ATTRIBUTION_CONTEXT.test(raw.slice(Math.max(0, start - 80), start));

const hasBodySupportedSpokenQuoteContext = (raw, start) =>
  SPOKEN_QUOTE_BODY_SUPPORTED_CONTEXT.test(raw.slice(Math.max(0, start - 80), start));

const hasSpokenQuoteOpenerContext = (raw, start, markerEnd) => {
  const prefix = raw.slice(Math.max(0, start - 80), start);
  if (hasStrongSpokenQuoteAttributionContext(raw, start)) return true;
  const hasSpeechLikeBody = hasLikelyStandaloneSpokenQuoteBody(raw, markerEnd);
  return (
    hasSpeechLikeBody &&
    (hasBodySupportedSpokenQuoteContext(raw, start) ||
      SPOKEN_QUOTE_DELIMITER_CONTEXT.test(prefix) ||
      !raw.slice(0, start).trim())
  );
};

const isLikelyLiteralQuotePhrase = (raw, markerEnd) =>
  LIKELY_LITERAL_QUOTE_TAIL.test(raw.slice(markerEnd, markerEnd + 100));

const isBareSpokenQuoteOpener = (raw, start, end) =>
  hasSpokenQuoteOpenerContext(raw, start, end) && !isLikelyLiteralQuotePhrase(raw, end);

const hasCompletePairedQuoteBody = (body) => {
  const normalized = normalizeQuoteWords(body);
  return Boolean(normalized) && !/\b(?:a|an|and|or|the|to)$/u.test(normalized);
};

const hasSpokenQuoteClosingBoundary = (raw, closingMatch) => {
  if (!closingMatch) return false;
  const closingEnd = closingMatch.end;
  return /^\s*(?:$|[.!?,;:]|(?:after|and|because|before|but|so|then|to)\b)/iu.test(
    raw.slice(closingEnd)
  );
};

const getBoundedSpokenQuoteMarkers = (raw) => {
  const markers = [];
  for (const match of raw.matchAll(SPOKEN_QUOTE_MARKER_GLOBAL)) {
    if (markers.length >= MAX_SPOKEN_QUOTE_MARKERS) {
      return { markers: [], nextClosingIndices: [], overflow: true };
    }
    markers.push({
      end: (match.index || 0) + match[0].length,
      qualifier: match.groups?.qualifier?.toLocaleLowerCase() || "",
      start: match.index || 0,
      text: match[0],
    });
  }

  // Resolve each marker's next closer once. Repeated slice/find scans made a
  // malformed transcript with thousands of markers quadratic.
  const nextClosingIndices = new Array(markers.length).fill(-1);
  let nextClosingIndex = -1;
  for (let markerIndex = markers.length - 1; markerIndex >= 0; markerIndex -= 1) {
    nextClosingIndices[markerIndex] = nextClosingIndex;
    if (["close", "end"].includes(markers[markerIndex].qualifier)) {
      nextClosingIndex = markerIndex;
    }
  }
  return { markers, nextClosingIndices, overflow: false };
};

const getExplicitSpokenQuotePairs = (value) => {
  const raw = String(value || "");
  const pairs = [];
  let opening = null;
  const { markers, nextClosingIndices, overflow } = getBoundedSpokenQuoteMarkers(raw);
  if (overflow) return pairs;
  for (let matchIndex = 0; matchIndex < markers.length; matchIndex += 1) {
    const marker = markers[matchIndex];
    const qualifier = marker.qualifier;
    if (["close", "end"].includes(qualifier)) {
      if (opening && marker.start > opening.end) {
        const body = raw.slice(opening.end, marker.start);
        if (QUOTE_LINE_BOUNDARY.test(body)) {
          opening = null;
          continue;
        }
        pairs.push({
          body,
          bodyEnd: marker.start,
          bodyStart: opening.end,
          markerRanges: [opening, marker],
          sourceEnd: marker.end,
          sourceStart: opening.start,
          type: "spoken",
        });
      }
      opening = null;
      continue;
    }

    const isExplicitOpening = ["begin", "open", "start"].includes(qualifier);
    const nextClosingIndex = nextClosingIndices[matchIndex];
    const nextClosingMatch = nextClosingIndex >= 0 ? markers[nextClosingIndex] : null;
    const hasSameLineClosingMarker = Boolean(
      nextClosingMatch && !QUOTE_LINE_BOUNDARY.test(raw.slice(marker.end, nextClosingMatch.start))
    );
    // A same-line closer is strong evidence, but it is not sufficient by
    // itself: UI phrases can contain both "Quote" and "close quote". Require
    // positive speech/body grammar for both qualified and bare paired openers.
    const hasPairedQuoteEvidence =
      !isLikelyLiteralQuotePhrase(raw, marker.end) &&
      !hasMetalinguisticSpeechPrefix(raw.slice(0, marker.start)) &&
      hasCompletePairedQuoteBody(raw.slice(marker.end, nextClosingMatch?.start || marker.end)) &&
      hasSpokenQuoteClosingBoundary(raw, nextClosingMatch) &&
      (hasStrongSpokenQuoteAttributionContext(raw, marker.start) ||
        hasLikelyStandaloneSpokenQuoteBody(raw, marker.end));
    if (!opening && isExplicitOpening && hasSameLineClosingMarker && hasPairedQuoteEvidence) {
      opening = marker;
    } else if (!opening && !qualifier && hasSameLineClosingMarker && hasPairedQuoteEvidence) {
      opening = marker;
    }
  }
  return pairs;
};

/**
 * A recognizer can preserve an opening spoken marker even when the speaker
 * never dictates "end quote". The cleanup model remains responsible for
 * deciding whether and where the quotation ends; this authorization only
 * proves that its chosen body remains closely aligned with the text
 * immediately following a genuine opener. Limiting the candidate to one line
 * prevents an ambiguous marker from authorizing unrelated later paragraphs.
 */
const getUnclosedSpokenQuoteOpeners = (value, pairedPairs) => {
  const raw = String(value || "");
  const pairedMarkerRanges = new Set(
    pairedPairs
      .flatMap((pair) => pair.markerRanges || [])
      .map((range) => `${range.start}:${range.end}`)
  );
  const sourceTokens = getQuoteComparisonTokens(raw);
  const discountedSpokenMarkerRanges = pairedPairs.flatMap((pair) => pair.markerRanges || []);
  const openers = [];
  const { markers, nextClosingIndices, overflow } = getBoundedSpokenQuoteMarkers(raw);
  if (overflow) return openers;

  for (let matchIndex = 0; matchIndex < markers.length; matchIndex += 1) {
    if (openers.length >= MAX_UNCLOSED_SPOKEN_QUOTE_OPENERS) break;
    const marker = markers[matchIndex];
    const qualifier = marker.qualifier;
    if (pairedMarkerRanges.has(`${marker.start}:${marker.end}`)) continue;
    if (["close", "end"].includes(qualifier)) continue;

    const nextClosingIndex = nextClosingIndices[matchIndex];
    const nextClosingMatch = nextClosingIndex >= 0 ? markers[nextClosingIndex] : null;
    if (
      nextClosingMatch &&
      !QUOTE_LINE_BOUNDARY.test(raw.slice(marker.end, nextClosingMatch.start))
    ) {
      // A marker with a same-line closer is a paired candidate. If the paired
      // classifier rejected it, do not weaken that decision by reconsidering
      // the opener as model-bounded/unclosed.
      continue;
    }

    const isExplicitOpening = ["begin", "open", "start"].includes(qualifier);
    if (
      (isExplicitOpening && !hasSpokenQuoteOpenerContext(raw, marker.start, marker.end)) ||
      (!isExplicitOpening && (qualifier || !isBareSpokenQuoteOpener(raw, marker.start, marker.end)))
    ) {
      continue;
    }
    if (isLikelyLiteralQuotePhrase(raw, marker.end)) continue;
    if (hasMetalinguisticSpeechPrefix(raw.slice(0, marker.start))) continue;

    const tail = raw.slice(marker.end);
    const lineBoundaryOffset = tail.search(QUOTE_LINE_BOUNDARY);
    const bodyEnd = lineBoundaryOffset >= 0 ? marker.end + lineBoundaryOffset : raw.length;
    const sourceTailTokens = sourceTokens.filter(
      (token) => token.start >= marker.end && token.end <= bodyEnd
    );
    if (sourceTailTokens.length === 0) continue;
    discountedSpokenMarkerRanges.push(marker);
    const bodyFirstToken = sourceTailTokens[0];

    openers.push({
      bodyFirstTokenOccurrenceIndex: getTokenValueOccurrenceIndexAt(
        raw,
        bodyFirstToken.value,
        bodyFirstToken.start,
        discountedSpokenMarkerRanges
      ),
      bodyFirstTokenValue: bodyFirstToken.value,
      bodyEnd,
      bodyStart: marker.end,
      leftAnchor: getLeftQuoteAnchor(raw, marker.start),
      markerRanges: [marker],
      matchMode: "spoken-prefix",
      required: false,
      sourceEnd: bodyEnd,
      sourceStart: marker.start,
      sourceTailTokens,
      type: "spoken",
    });
  }

  return openers;
};

const getNarrowMisrecognizedSpokenQuotePair = (value) => {
  const match = getMisrecognizedSpokenQuoteBoundary(value);
  if (!match) return [];
  return [
    {
      body: match.body,
      bodyEnd: match.bodyEnd,
      bodyStart: match.bodyStart,
      markerRanges: [
        { end: match.openingEnd, start: match.openingStart, text: match.openingText },
        { end: match.closingEnd, start: match.closingStart, text: match.closingText },
      ],
      sourceEnd: match.closingEnd,
      sourceStart: match.openingStart,
      type: "spoken",
    },
  ];
};

const rangesOverlap = (leftStart, leftEnd, rightStart, rightEnd) =>
  leftStart < rightEnd && rightStart < leftEnd;

const getGovernedAuthorizations = (value, occupiedRanges) => {
  const raw = String(value || "");
  const authorizations = [];
  for (const match of raw.matchAll(GOVERNED_DIRECT_SPEECH)) {
    const body = match.groups?.body || "";
    const verb = match.groups?.verb?.toLocaleLowerCase() || "";
    const prefix = raw.slice(0, match.index || 0);
    if (hasMetalinguisticSpeechPrefix(prefix)) continue;
    const isDirectQuestion = ["ask", "asked"].includes(verb) && DIRECT_QUESTION_OPENER.test(body);
    const isDirectStatement = ["said", "says"].includes(verb) && DIRECT_SPEECH_OPENER.test(body);
    if (!isDirectQuestion && !isDirectStatement) continue;
    const bodyOffset = match[0].lastIndexOf(body);
    const bodyStart = (match.index || 0) + bodyOffset;
    const bodyEnd = bodyStart + body.length;
    if (occupiedRanges.some((range) => rangesOverlap(bodyStart, bodyEnd, range.start, range.end))) {
      continue;
    }
    authorizations.push({
      body,
      matchMode: "words",
      outputLeadPattern: new RegExp(`\\b${verb}\\s*[,;:—–-]?\\s*$`, "iu"),
      required: false,
      sourceEnd: bodyEnd,
      sourceStart: match.index || 0,
      type: "governed",
    });
  }

  for (const match of raw.matchAll(GOVERNED_INDIRECT_QUESTION)) {
    const body = match.groups?.body || "";
    authorizations.push({
      body,
      matchMode: "indirect-question",
      outputLeadPattern: /\bask(?:ed)?\s*[,;:—–-]?\s*$/iu,
      required: false,
      sourceEnd: (match.index || 0) + match[0].length,
      sourceStart: match.index || 0,
      type: "governed",
    });
  }
  return authorizations;
};

const getIndirectQuestionForms = (value) => {
  const words = normalizeQuoteWords(value).split(/\s+/u).filter(Boolean);
  const auxiliaryIndex = words.findIndex(
    (word, index) =>
      index > 0 &&
      [
        "am",
        "are",
        "can",
        "could",
        "did",
        "do",
        "does",
        "had",
        "has",
        "have",
        "is",
        "may",
        "might",
        "should",
        "was",
        "were",
        "will",
        "would",
      ].includes(word)
  );
  const forms = [words.join(" ")];
  if (auxiliaryIndex > 0) {
    forms.push(
      [
        words[auxiliaryIndex],
        ...words.slice(0, auxiliaryIndex),
        ...words.slice(auxiliaryIndex + 1),
      ].join(" ")
    );
  }
  return forms;
};

const removeRanges = (value, ranges) => {
  const raw = String(value || "");
  const ordered = [...ranges].sort((left, right) => left.start - right.start);
  let result = "";
  let cursor = 0;
  for (const range of ordered) {
    if (range.start < cursor) continue;
    result += `${raw.slice(cursor, range.start)} `;
    cursor = range.end;
  }
  return result + raw.slice(cursor);
};

export const assessQuotationFidelity = (original, cleaned) => {
  const source = String(original || "");
  const output = String(cleaned || "");
  const sourceLiteralPairs = extractQuotationPairs(source);
  const explicitSpokenPairs = getExplicitSpokenQuotePairs(source);
  const narrowSpokenPairs = getNarrowMisrecognizedSpokenQuotePair(source).filter(
    (candidate) =>
      !explicitSpokenPairs.some((pair) =>
        rangesOverlap(candidate.sourceStart, candidate.sourceEnd, pair.sourceStart, pair.sourceEnd)
      )
  );
  const spokenPairs = [...explicitSpokenPairs, ...narrowSpokenPairs];
  const unclosedSpokenOpeners = getUnclosedSpokenQuoteOpeners(source, spokenPairs);
  const occupiedRanges = [
    ...sourceLiteralPairs.map((pair) => ({ start: pair.start, end: pair.end })),
    ...spokenPairs.map((pair) => ({ start: pair.sourceStart, end: pair.sourceEnd })),
  ];
  const sourceContexts = getContextualSourceOccurrences(source);
  const authorizations = [
    ...sourceLiteralPairs.map((pair) => ({
      body: getPairExactText(pair, source),
      bodyOccurrenceIndex: getQuoteBodyOccurrenceIndex(
        source,
        pair.body,
        pair.bodyStart,
        pair.bodyEnd
      ),
      leftAnchor: getLeftQuoteAnchor(source, pair.start),
      locationBound: true,
      matchMode: "exact",
      required: true,
      rightAnchor: getRightQuoteAnchor(source, pair.end),
      sourceEnd: pair.end,
      sourceStart: pair.start,
      type: "literal",
    })),
    ...spokenPairs.map((pair) => ({
      ...pair,
      bodyOccurrenceIndex: getQuoteBodyOccurrenceIndex(
        source,
        pair.body,
        pair.bodyStart,
        pair.bodyEnd
      ),
      leftAnchor: getLeftQuoteAnchor(source, pair.sourceStart),
      locationBound: true,
      matchMode: "words",
      required: false,
      rightAnchor: getRightQuoteAnchor(source, pair.sourceEnd),
    })),
    ...unclosedSpokenOpeners,
    ...sourceContexts
      .filter(
        (context) =>
          !sourceLiteralPairs.some((pair) =>
            rangesOverlap(context.sentenceStart, context.sentenceEnd, pair.start, pair.end)
          )
      )
      .map((context) => ({
        body: context.sentenceText,
        contextIndex: context.contextIndex,
        matchMode: "exact",
        required: false,
        sourceEnd: context.sentenceEnd,
        sourceStart: context.sentenceStart,
        type: "contextual",
      })),
    ...getGovernedAuthorizations(source, occupiedRanges),
  ].sort((left, right) => left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd);

  const outputPairs = extractQuotationPairs(output);
  const outputContexts = getContextualOutputOccurrences(output);
  const matchedAuthorizationIndexes = new Set();
  const matches = [];
  let authorizationCursor = 0;
  for (let outputIndex = 0; outputIndex < outputPairs.length; outputIndex += 1) {
    const pair = outputPairs[outputIndex];
    const pairContextIndex = getOutputContextIndex(pair, output, outputContexts);
    const pairBodyOccurrenceIndex = getQuoteBodyOccurrenceIndex(
      output,
      pair.body,
      pair.bodyStart,
      pair.bodyEnd
    );
    const pairLeftAnchor = getLeftQuoteAnchor(output, pair.start);
    const pairRightAnchor = getRightQuoteAnchor(output, pair.end);
    let matchedIndex = -1;
    for (let index = authorizationCursor; index < authorizations.length; index += 1) {
      const authorization = authorizations[index];
      if (authorization.type === "contextual" && pairContextIndex !== authorization.contextIndex) {
        continue;
      }
      if (
        authorization.locationBound &&
        (authorization.leftAnchor !== pairLeftAnchor ||
          authorization.rightAnchor !== pairRightAnchor ||
          authorization.bodyOccurrenceIndex !== pairBodyOccurrenceIndex)
      ) {
        continue;
      }
      if (
        authorization.outputLeadPattern &&
        !authorization.outputLeadPattern.test(
          output.slice(Math.max(0, pair.start - 100), pair.start)
        )
      ) {
        continue;
      }

      const pairWords = normalizeQuoteWords(pair.body);
      let bodyMatches = false;
      if (authorization.matchMode === "exact") {
        bodyMatches =
          normalizeExactQuoteSpan(getPairExactText(pair, output)) ===
          normalizeExactQuoteSpan(authorization.body);
      } else if (authorization.matchMode === "indirect-question") {
        bodyMatches = getIndirectQuestionForms(authorization.body).includes(pairWords);
      } else if (authorization.matchMode === "spoken-prefix") {
        const outputBodyTokens = getQuoteComparisonTokens(output).filter(
          (token) => token.start >= pair.bodyStart && token.end <= pair.bodyEnd
        );
        const outputWords = outputBodyTokens.map((token) => token.value);
        const sourceTailTokens = authorization.sourceTailTokens || [];
        const alignment = getSpokenQuotePrefixAlignment(sourceTailTokens, outputWords);
        const outputFirstToken = outputBodyTokens[0];
        const outputFirstTokenOccurrenceIndex = outputFirstToken
          ? getTokenValueOccurrenceIndexAt(output, outputFirstToken.value, outputFirstToken.start)
          : -1;
        if (alignment) {
          const sourceBodyEnd = sourceTailTokens[alignment.sourceTokenCount - 1].end;
          bodyMatches =
            authorization.bodyFirstTokenValue === outputFirstToken?.value &&
            authorization.bodyFirstTokenOccurrenceIndex === outputFirstTokenOccurrenceIndex &&
            authorization.leftAnchor === pairLeftAnchor &&
            getRightQuoteAnchor(source, sourceBodyEnd) === pairRightAnchor;
        }
      } else {
        bodyMatches = normalizeQuoteWords(authorization.body) === pairWords;
      }
      if (!bodyMatches) continue;
      matchedIndex = index;
      break;
    }

    if (matchedIndex >= 0) {
      matchedAuthorizationIndexes.add(matchedIndex);
      matches.push({ authorization: authorizations[matchedIndex], outputIndex });
      authorizationCursor = matchedIndex + 1;
    }
  }

  const matchedOutputIndexes = new Set(matches.map((match) => match.outputIndex));
  const missingRequiredPairCount = authorizations.filter(
    (authorization, index) => authorization.required && !matchedAuthorizationIndexes.has(index)
  ).length;
  const unmatchedOutputPairCount = outputPairs.filter(
    (_pair, index) => !matchedOutputIndexes.has(index)
  ).length;
  const sourceUnpairedGlyphs = getUnpairedQuotationGlyphs(source, sourceLiteralPairs);
  const outputUnpairedGlyphs = getUnpairedQuotationGlyphs(output, outputPairs);
  const hasUnalignedUnpairedGlyphs =
    JSON.stringify(sourceUnpairedGlyphs) !== JSON.stringify(outputUnpairedGlyphs);
  const appliedSpokenPairs = matches
    .map((match) => match.authorization)
    .filter((authorization) => authorization.type === "spoken");
  const verifiedContextualPairCount = matches.filter(
    (match) => match.authorization.type === "contextual"
  ).length;

  return {
    appliedSpokenPairs,
    comparisonOriginalText: removeRanges(
      source,
      appliedSpokenPairs.flatMap((pair) => pair.markerRanges || [])
    ),
    unverifiedPairCount:
      missingRequiredPairCount + unmatchedOutputPairCount + (hasUnalignedUnpairedGlyphs ? 1 : 0),
    verifiedContextualPairCount,
  };
};

export const countSpokenQuoteMarkers = (value) =>
  (String(value || "").match(SPOKEN_QUOTE_MARKER_GLOBAL) || []).length;

export const countUnclosedSpokenQuoteOpeners = (value) => {
  const source = String(value || "");
  const explicitPairs = getExplicitSpokenQuotePairs(source);
  return getUnclosedSpokenQuoteOpeners(source, explicitPairs).length;
};

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

export const countVerifiedContextualQuotationPairs = (original, cleaned) =>
  assessQuotationFidelity(original, cleaned).verifiedContextualPairCount;

export const countUnverifiedContextualQuotationPairs = (original, cleaned) =>
  assessQuotationFidelity(original, cleaned).unverifiedPairCount;

export const countUnverifiedQuotationPairs = countUnverifiedContextualQuotationPairs;

export const getAppliedSpokenQuoteMarkerTexts = (original, cleaned) =>
  assessQuotationFidelity(original, cleaned).appliedSpokenPairs.flatMap((pair) =>
    (pair.markerRanges || []).map((range) => range.text)
  );

export const getSpokenQuoteAttachmentComparisonText = (original, cleaned) =>
  assessQuotationFidelity(original, cleaned).comparisonOriginalText;

export default {
  assessQuotationFidelity,
  countQuotationGlyphs,
  countSpokenQuoteMarkers,
  countUnverifiedContextualQuotationPairs,
  countUnverifiedQuotationPairs,
  countVerifiedContextualQuotationPairs,
  getAppliedSpokenQuoteMarkerTexts,
  getSpokenQuoteAttachmentComparisonText,
};
