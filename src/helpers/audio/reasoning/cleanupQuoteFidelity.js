import { getMisrecognizedSpokenQuoteBoundary } from "./cleanupInputRepairs";

const SPOKEN_QUOTE_MARKER_GLOBAL = /\b(?:(?<qualifier>open|start|begin|close|end)\s+)?quotes?\b/giu;

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

const isBareSpokenQuoteOpener = (raw, start) =>
  /(?:^|[,;:]\s*|\b(?:and|asked|said|says|then|write|wrote)\s+)$/iu.test(
    raw.slice(Math.max(0, start - 60), start)
  );

const getExplicitSpokenQuotePairs = (value) => {
  const raw = String(value || "");
  const pairs = [];
  let opening = null;
  for (const match of raw.matchAll(SPOKEN_QUOTE_MARKER_GLOBAL)) {
    const qualifier = match.groups?.qualifier?.toLocaleLowerCase() || "";
    const marker = {
      end: (match.index || 0) + match[0].length,
      start: match.index || 0,
      text: match[0],
    };
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
    if (
      !opening &&
      (isExplicitOpening || (!qualifier && isBareSpokenQuoteOpener(raw, marker.start)))
    ) {
      opening = marker;
    }
  }
  return pairs;
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

const assessQuotationFidelity = (original, cleaned) => {
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
  countQuotationGlyphs,
  countSpokenQuoteMarkers,
  countUnverifiedContextualQuotationPairs,
  countUnverifiedQuotationPairs,
  countVerifiedContextualQuotationPairs,
  getAppliedSpokenQuoteMarkerTexts,
  getSpokenQuoteAttachmentComparisonText,
};
