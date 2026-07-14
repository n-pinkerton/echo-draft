import { countWords } from "../utils/wordCount";
import { hasGovernedExplicitQuoteAttachment } from "./cleanupOutputRepairs";

const ASSISTANT_ACTION_OPENERS = [
  /^(?:certainly|absolutely|sure|of course)[,!.:\s]/i,
  /^(?:here(?:'s| is| are)|done|completed)[,!.:\s]/i,
  /^i\s+(?:have|will|can|did|checked|created|updated|implemented)\b/i,
];

const CONTENT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "hers",
  "him",
  "his",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "ours",
  "she",
  "so",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "then",
  "they",
  "this",
  "to",
  "us",
  "was",
  "we",
  "were",
  "with",
  "you",
  "your",
  "yours",
]);

const NEGATION_MARKERS = ["not", "never", "without", "unless", "except"];
const RELATION_MARKERS = [
  "after",
  "although",
  "because",
  "before",
  "finally",
  "first",
  "however",
  "later",
  "next",
  "once",
  "otherwise",
  "subsequently",
  "then",
  "until",
  "when",
  "while",
];
const STANCE_MARKERS = [
  "maybe",
  "perhaps",
  "possibly",
  "probably",
  "likely",
  "unlikely",
  "apparently",
  "seemingly",
  "roughly",
  "approximately",
  "about",
  "around",
  "preferably",
  "ideally",
  "slightly",
  "somewhat",
  "almost",
  "generally",
  "usually",
  "mostly",
  "only",
  "just",
];
const STANCE_PHRASES = [
  "if possible",
  "i think",
  "i guess",
  "i suppose",
  "it seems",
  "it appears",
  "sort of",
  "kind of",
  "a little",
];
const CLEAR_SELF_CORRECTION = /\b(?:no[,]?\s+sorry|sorry[,]?\s+i mean|correction|make that)\b/i;
const SPOKEN_QUOTE_MARKER = /\b(?:open|start|begin|close|end)?\s*quote(?:s|d)?\b/i;
const SPOKEN_QUOTE_MARKER_GLOBAL = /\b(?:(?:open|start|begin|close|end)\s+)?quotes?\b/gi;
const WHOLE_OUTPUT_QUOTE_PAIRS = [
  ['"', '"'],
  ["“", "”"],
  ["'", "'"],
  ["‘", "’"],
];
const TECHNICAL_TOKEN_PATTERN = /[A-Za-z0-9]+(?:[._+:/\\-][A-Za-z0-9]+)+|[A-Za-z][A-Za-z0-9]*/g;
const TECHNICAL_CONTEXT_PATTERN =
  /\b([A-Za-z0-9][A-Za-z0-9._+:/\\-]*)\s+(?=(?:agent|file|folder|directory|model|identifier|id|path)\b)/gi;
const INCOMPLETE_WORKFLOW_PROGRESSION =
  /^(?:please\s+)?(?:keep|continue)\s+(?:doing|working|operating)\b[\s\S]*\buntil\b[\s\S]*\band\s+then\s+(?!(?:advance|begin|complete|conduct|continue|do|handle|move|perform|proceed|run|start|switch|transition|use)\b)(?:the\s+)?(?:[\p{L}-]+\s+){0,8}(?:checks?|gates?|passes|phases?|reviews?|stages?|steps?|validation)\s*[.!?]?$/iu;
const COMPLETED_WORKFLOW_PROGRESSION =
  /\band\s+then\s+(?:advance|begin|complete|conduct|continue|do|handle|move|perform|proceed|run|start|switch|transition|use)\b/iu;
const IRREGULAR_COMPLETION_VERBS = new Set([
  "arose",
  "awoke",
  "became",
  "began",
  "bent",
  "bet",
  "bit",
  "bled",
  "blew",
  "bought",
  "broke",
  "brought",
  "built",
  "caught",
  "chose",
  "came",
  "cost",
  "cut",
  "dealt",
  "dug",
  "did",
  "done",
  "drew",
  "drank",
  "drove",
  "ate",
  "fell",
  "fed",
  "felt",
  "fought",
  "found",
  "flew",
  "forgot",
  "forgave",
  "froze",
  "got",
  "gave",
  "went",
  "grew",
  "had",
  "heard",
  "held",
  "kept",
  "knew",
  "laid",
  "led",
  "left",
  "lent",
  "let",
  "lay",
  "lost",
  "made",
  "meant",
  "met",
  "paid",
  "put",
  "read",
  "rode",
  "rang",
  "rose",
  "ran",
  "said",
  "saw",
  "sold",
  "sent",
  "set",
  "shook",
  "shone",
  "shot",
  "showed",
  "shut",
  "sang",
  "sank",
  "sat",
  "slept",
  "slid",
  "spoke",
  "spent",
  "spun",
  "stood",
  "stole",
  "stuck",
  "stung",
  "struck",
  "swam",
  "took",
  "taught",
  "tore",
  "told",
  "thought",
  "threw",
  "understood",
  "woke",
  "wore",
  "won",
  "wrote",
]);
const MODAL_MARKERS = ["can", "could", "may", "might", "must", "shall", "should", "will", "would"];
const REQUEST_MODAL_OPENER =
  /(^|[.!?]\s+)((?:please\s+)?)(can|could|may|might|shall|should|will|would)\s+(you|i)\b/gi;
const MAX_EXACT_BIGRAM_MATCH_CANDIDATES = 250_000;
const ATTACHMENT_FUNCTION_WORDS = new Set([
  ...CONTENT_STOP_WORDS,
  ...NEGATION_MARKERS,
  ...RELATION_MARKERS,
  ...STANCE_MARKERS,
  ...MODAL_MARKERS,
  "am",
  "did",
  "do",
  "does",
  "please",
]);

const normalizeContractions = (value) =>
  value
    .replace(/\bcan't\b/gi, "can not")
    .replace(/\bcannot\b/gi, "can not")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/\bshan't\b/gi, "shall not")
    .replace(/\bain't\b/gi, "is not")
    .replace(/\b([a-z]+)n't\b/gi, "$1 not");

const normalizeForComparison = (value) =>
  normalizeContractions(
    String(value || "")
      .normalize("NFKC")
      .replace(/[’‘]/g, "'")
  )
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim();

const getStrictCaseLocale = (language) => {
  const primary =
    typeof language === "string" ? language.trim().toLowerCase().split(/[-_]/u)[0] : "";
  return primary === "tr" || primary === "az" ? primary : null;
};

const normalizeStrictLexicalToken = (token, language) => {
  const normalized = token.normalize("NFC").replace(/[’‘ʼ]/g, "'");
  const locale = getStrictCaseLocale(language);
  return (locale ? normalized.toLocaleLowerCase(locale) : normalized.toLowerCase())
    .replace(/i\u0307/gu, "i")
    .replace(/ς/g, "σ")
    .normalize("NFC");
};

const getStrictLexicalMatches = (value) =>
  Array.from(
    String(value || "")
      .normalize("NFC")
      .matchAll(/[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}]|['’‘ʼ](?=[\p{L}\p{M}\p{N}]))*/gu)
  );

const getStrictLexicalTokens = (value, language) =>
  getStrictLexicalMatches(value).map((match) => normalizeStrictLexicalToken(match[0], language));

const applySafeStrictSentenceStartCase = (originalToken, cleanedToken, language) => {
  if (originalToken === cleanedToken) return originalToken;
  // Never let a punctuation-only strict retry rewrite acronyms, identifiers, or
  // name-like casing (for example US, IT, or PowerShell). Only accept the exact
  // first-letter capitalization of an otherwise lowercase source token.
  if (!/^\p{Ll}[\p{Ll}\p{M}\p{N}'’‘ʼ]*$/u.test(originalToken)) return originalToken;
  const [first = "", ...rest] = Array.from(originalToken);
  const locale = getStrictCaseLocale(language);
  const uppercaseFirst = locale ? first.toLocaleUpperCase(locale) : first.toUpperCase();
  const expected = `${uppercaseFirst}${rest.join("")}`;
  return cleanedToken === expected ? cleanedToken : originalToken;
};

/**
 * Keeps the recognizer's punctuation, spacing, and in-sentence token spelling while
 * accepting sentence-start casing from a token-locked strict cleanup result. This
 * prevents a comma or sentence boundary introduced by the rescue pass from changing
 * meaning or leaving capitalization that depended on the discarded punctuation.
 */
export function applyStrictCleanupTokensToOriginalPunctuation(
  originalText,
  cleanedText,
  options = {}
) {
  const language = options.language;
  const original = String(originalText || "").normalize("NFC");
  const cleaned = String(cleanedText || "").normalize("NFC");
  const originalMatches = getStrictLexicalMatches(original);
  const cleanedMatches = getStrictLexicalMatches(cleaned);
  const originalTokens = originalMatches.map((match) =>
    normalizeStrictLexicalToken(match[0], language)
  );
  const cleanedTokens = cleanedMatches.map((match) =>
    normalizeStrictLexicalToken(match[0], language)
  );

  if (getFirstSequenceMismatch(originalTokens, cleanedTokens) !== null) {
    return original;
  }

  let result = "";
  let sourceCursor = 0;
  for (let index = 0; index < originalMatches.length; index += 1) {
    const originalMatch = originalMatches[index];
    const cleanedMatch = cleanedMatches[index];
    const matchIndex = originalMatch.index || 0;
    const sourceGap = original.slice(sourceCursor, matchIndex);
    result += sourceGap;
    result +=
      index === 0 || /[.!?][\s"'”’)]*$/u.test(sourceGap)
        ? applySafeStrictSentenceStartCase(originalMatch[0], cleanedMatch[0], language)
        : originalMatch[0];
    sourceCursor = matchIndex + originalMatch[0].length;
  }
  return result + original.slice(sourceCursor);
}

const isStrictLexicalCharacter = (value) => /[\p{L}\p{M}\p{N}]/u.test(value || "");

const getCodePointBefore = (value, index) => {
  const prefix = value.slice(0, index);
  const codePoints = Array.from(prefix);
  return codePoints[codePoints.length - 1] || "";
};

const getCodePointAt = (value, index) => Array.from(value.slice(index))[0] || "";

const isStrictProtectedGapCharacter = (value, index, character) => {
  const previous = getCodePointBefore(value, index);
  const next = getCodePointAt(value, index + character.length);

  if (/[\p{S}\p{M}%‰‱@#&*_\/\\]/u.test(character)) return true;
  if (/[-‐‑_]/u.test(character)) return true;
  if (character === ".") {
    return (
      (isStrictLexicalCharacter(previous) && isStrictLexicalCharacter(next)) ||
      (!previous && isStrictLexicalCharacter(next)) ||
      (/[/\\]/u.test(previous) && isStrictLexicalCharacter(next))
    );
  }
  if (character === ":") {
    return (
      isStrictLexicalCharacter(previous) && (isStrictLexicalCharacter(next) || /[/\\]/u.test(next))
    );
  }
  if (character === "?" || character === ";") {
    return isStrictLexicalCharacter(previous) && isStrictLexicalCharacter(next);
  }
  if (character === ",") return /\p{N}/u.test(previous) && /\p{N}/u.test(next);
  return false;
};

const getStrictSignificantTokenStream = (value, language) => {
  const normalized = String(value || "").normalize("NFC");
  const stream = [];

  const significantMatches = normalized.matchAll(
    /[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}]|['’‘ʼ](?=[\p{L}\p{M}\p{N}]))*|[\p{S}\p{M}%‰‱@#&*_\/\\\-‐‑.,:;?]/gu
  );

  for (const match of significantMatches) {
    const token = match[0];
    if (/^[\p{L}\p{N}]/u.test(token)) {
      stream.push(`lexical:${normalizeStrictLexicalToken(token, language)}`);
    } else if (isStrictProtectedGapCharacter(normalized, match.index || 0, token)) {
      stream.push(`protected:${token}`);
    }
  }
  return stream;
};

const getFirstSequenceMismatch = (originalItems, cleanedItems) => {
  const comparedItemCount = Math.min(originalItems.length, cleanedItems.length);
  for (let index = 0; index < comparedItemCount; index += 1) {
    if (originalItems[index] !== cleanedItems[index]) return index;
  }
  return originalItems.length === cleanedItems.length ? null : comparedItemCount;
};

const getWords = (value) => normalizeForComparison(value).split(/\s+/).filter(Boolean);

/**
 * Enforces the strict retry's mechanical-only contract. Punctuation,
 * capitalization, paragraph boundaries, and straight/curly apostrophe glyphs
 * may change; lexical words, protected symbols, and technical tokens may not.
 */
export function assessStrictCleanupLexicalFidelity(originalText, cleanedText, options = {}) {
  const language = options.language;
  const originalTokens = getStrictLexicalTokens(originalText, language);
  const cleanedTokens = getStrictLexicalTokens(cleanedText, language);
  const originalSignificantTokens = getStrictSignificantTokenStream(originalText, language);
  const cleanedSignificantTokens = getStrictSignificantTokenStream(cleanedText, language);
  const firstMismatchIndex = getFirstSequenceMismatch(originalTokens, cleanedTokens);
  const firstSignificantMismatchIndex = getFirstSequenceMismatch(
    originalSignificantTokens,
    cleanedSignificantTokens
  );
  const reasons = [];
  if (firstMismatchIndex !== null) reasons.push("strict-lexical-sequence-change");
  if (firstSignificantMismatchIndex !== null) reasons.push("strict-significant-token-change");

  return {
    accepted: reasons.length === 0,
    reasons,
    metrics: {
      strictLexicalOriginalTokenCount: originalTokens.length,
      strictLexicalCleanedTokenCount: cleanedTokens.length,
      strictLexicalFirstMismatchIndex: firstMismatchIndex,
      strictSignificantOriginalTokenCount: originalSignificantTokens.length,
      strictSignificantCleanedTokenCount: cleanedSignificantTokens.length,
      strictSignificantFirstMismatchIndex: firstSignificantMismatchIndex,
    },
  };
}

const pushIncreasingPosition = (tails, position) => {
  let low = 0;
  let high = tails.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (tails[middle] < position) low = middle + 1;
    else high = middle;
  }
  tails[low] = position;
};

const getOrderedBigramRetention = (originalWords, cleanedWords) => {
  if (originalWords.length < 2) return 1;

  const originalBigrams = [];
  for (let index = 0; index < originalWords.length - 1; index += 1) {
    originalBigrams.push(`${originalWords[index]}\u0000${originalWords[index + 1]}`);
  }

  const cleanedBigramPositions = new Map();
  for (let index = 0; index < cleanedWords.length - 1; index += 1) {
    const key = `${cleanedWords[index]}\u0000${cleanedWords[index + 1]}`;
    const positions = cleanedBigramPositions.get(key) || [];
    positions.push(index);
    cleanedBigramPositions.set(key, positions);
  }

  let candidateCount = 0;
  for (const key of originalBigrams) {
    candidateCount += cleanedBigramPositions.get(key)?.length || 0;
    if (candidateCount > MAX_EXACT_BIGRAM_MATCH_CANDIDATES) break;
  }

  const tails = [];
  if (candidateCount <= MAX_EXACT_BIGRAM_MATCH_CANDIDATES) {
    // Hunt-Szymanski LCS: processing matching positions in reverse preserves
    // duplicate occurrences while measuring sequence order, not just a bag of
    // adjacent pairs.
    for (const key of originalBigrams) {
      const positions = cleanedBigramPositions.get(key) || [];
      for (let index = positions.length - 1; index >= 0; index -= 1) {
        pushIncreasingPosition(tails, positions[index]);
      }
    }
  } else {
    // Pathological repeated input can create a quadratic match set. Pair equal
    // occurrences in sequence and calculate a conservative ordered subsequence
    // instead of allowing untrusted text to consume unbounded CPU.
    const occurrenceCursors = new Map();
    for (const key of originalBigrams) {
      const positions = cleanedBigramPositions.get(key) || [];
      const cursor = occurrenceCursors.get(key) || 0;
      if (cursor < positions.length) {
        pushIncreasingPosition(tails, positions[cursor]);
        occurrenceCursors.set(key, cursor + 1);
      }
    }
  }

  return tails.length / originalBigrams.length;
};

const isContentWord = (word) =>
  word.length >= 3 && !CONTENT_STOP_WORDS.has(word) && !/^\d+$/.test(word);

const getContentWordTokens = (value) => getWords(value).filter(isContentWord);

const getContentWords = (value) => new Set(getContentWordTokens(value));

const stemComparableWord = (word) => {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  for (const suffix of ["ingly", "edly", "ing", "ed", "es", "ly", "s"]) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
};

const getRawLexicalTokenMatches = (value) =>
  Array.from(
    String(value || "").matchAll(/[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}]|['’‘ʼ](?=[\p{L}\p{M}\p{N}]))*/gu)
  );

const getRawLexicalTokens = (value) => getRawLexicalTokenMatches(value).map((match) => match[0]);

const PREFERRED_SPELLING_ALIAS_NAME_SHAPE = /^\p{Lu}[\p{Ll}\p{M}]{4,}$/u;
const PREFERRED_SPELLING_ALIAS_BLOCKED_CONTEXT_WORDS = new Set([
  "agent",
  "alias",
  "argument",
  "class",
  "code",
  "column",
  "command",
  "constant",
  "directory",
  "enum",
  "field",
  "file",
  "folder",
  "function",
  "identifier",
  "key",
  "label",
  "literal",
  "method",
  "model",
  "option",
  "parameter",
  "path",
  "property",
  "setting",
  "string",
  "symbol",
  "table",
  "tag",
  "term",
  "text",
  "token",
  "type",
  "value",
  "variable",
  "word",
  "words",
]);
const PREFERRED_SPELLING_ALIAS_PERSON_DIRECTED_VERBS = new Set([
  "ask",
  "asked",
  "brief",
  "briefed",
  "call",
  "called",
  "contact",
  "contacted",
  "email",
  "emailed",
  "give",
  "gave",
  "hear",
  "heard",
  "invite",
  "invited",
  "meet",
  "met",
  "message",
  "messaged",
  "notify",
  "notified",
  "remind",
  "reminded",
  "send",
  "sent",
  "show",
  "showed",
  "speak",
  "spoke",
  "talk",
  "talked",
  "tell",
  "thank",
  "thanked",
  "told",
]);
const PREFERRED_SPELLING_ALIAS_RECIPIENT_LINKERS = new Set(["for", "from", "to", "with"]);
const PREFERRED_SPELLING_ALIAS_PRESERVATION_PREFIX =
  /\b(?:do not|never)\s+(?:alter|change|correct|edit|rename|replace|respell|rewrite)\b/iu;
const PREFERRED_SPELLING_ALIAS_PRESERVATION_SUFFIX =
  /\b(?:as\s+(?:originally\s+)?(?:dictated|spelled|typed|written)|unaltered|unchanged|verbatim)\b/iu;
const PREFERRED_SPELLING_ALIAS_NEGATED_PASSIVE_EDIT_SUFFIX =
  /^(?:(?:can|could|may|might|must|shall|should|will|would)\s+(?:never|not)\s+(?:(?:be|have\s+been|remain)\s+)?|(?:am|are|is|was|were)\s+(?:never|not)\s+(?:(?:being|to\s+be)\s+)?|(?:had|has|have)\s+(?:never|not)\s+been\s+)(?:altered|changed|corrected|edited|renamed|replaced|respelled|rewritten)\b/u;
const PREFERRED_SPELLING_ALIAS_CLAUSE_BOUNDARY = /[.!?;\r\n]/u;

const getPreferredSpellingAliasClauseBounds = (raw, sourceStart, sourceEnd) => {
  let start = sourceStart;
  while (start > 0 && !PREFERRED_SPELLING_ALIAS_CLAUSE_BOUNDARY.test(raw[start - 1])) {
    start -= 1;
  }

  let end = sourceEnd;
  while (end < raw.length && !PREFERRED_SPELLING_ALIAS_CLAUSE_BOUNDARY.test(raw[end])) {
    end += 1;
  }
  return { start, end };
};

const isStandaloneStraightQuote = (raw, index, quote) => {
  if (quote !== "'") return true;
  return !(
    /[\p{L}\p{N}]/u.test(raw[index - 1] || "") && /[\p{L}\p{N}]/u.test(raw[index + 1] || "")
  );
};

const isInsidePreferredSpellingDelimitedSpan = (raw, sourceStart, sourceEnd, clauseStart) => {
  for (const quote of ['"', "'", "`"]) {
    let openingCount = 0;
    for (let index = clauseStart; index < sourceStart; index += 1) {
      if (raw[index] === quote && isStandaloneStraightQuote(raw, index, quote)) openingCount += 1;
    }
    if (openingCount % 2 === 0) continue;
    for (let index = sourceEnd; index < raw.length; index += 1) {
      if (raw[index] === quote && isStandaloneStraightQuote(raw, index, quote)) return true;
    }
  }

  return [
    ["“", "”"],
    ["‘", "’"],
  ].some(([openingQuote, closingQuote]) => {
    const openingIndex = raw.lastIndexOf(openingQuote, sourceStart - 1);
    const priorClosingIndex = raw.lastIndexOf(closingQuote, sourceStart - 1);
    return (
      openingIndex >= clauseStart &&
      openingIndex > priorClosingIndex &&
      raw.indexOf(closingQuote, sourceEnd) >= sourceEnd
    );
  });
};

const hasPreferredSpellingTechnicalDefinition = (suffixWords) => {
  let cursor = 0;
  if (["is", "means", "represents", "was"].includes(suffixWords[cursor])) {
    cursor += 1;
  } else if (suffixWords[cursor] === "remains") {
    cursor += 1;
  } else if (
    ["must", "should", "will"].includes(suffixWords[cursor]) &&
    ["be", "remain"].includes(suffixWords[cursor + 1])
  ) {
    cursor += 2;
  } else {
    return false;
  }

  while (["a", "an", "currently", "still", "the", "this", "that"].includes(suffixWords[cursor])) {
    cursor += 1;
  }
  const firstDescriptor = suffixWords[cursor] || "";
  if (
    firstDescriptor &&
    !PREFERRED_SPELLING_ALIAS_BLOCKED_CONTEXT_WORDS.has(firstDescriptor) &&
    /(?:ed|ing)$/u.test(firstDescriptor)
  ) {
    return false;
  }
  return suffixWords
    .slice(cursor, cursor + 4)
    .some((word) => PREFERRED_SPELLING_ALIAS_BLOCKED_CONTEXT_WORDS.has(word));
};

const hasPreferredSpellingTechnicalObjectComplement = (suffixWords) => {
  let cursor = suffixWords[0] === "as" ? 1 : 0;
  while (["a", "an", "that", "the", "this"].includes(suffixWords[cursor])) {
    cursor += 1;
  }
  return PREFERRED_SPELLING_ALIAS_BLOCKED_CONTEXT_WORDS.has(suffixWords[cursor]);
};

const isLikelyPreferredSpellingPersonName = (rawToken) => /^[\p{Lu}]/u.test(rawToken || "");

const hasDirectedPreferredSpellingPersonContext = (clauseMatches, sourceIndex) => {
  const words = clauseMatches.map((match) => getWords(match[0])[0] || "");
  const previousWord = words[sourceIndex - 1] || "";
  if (PREFERRED_SPELLING_ALIAS_PERSON_DIRECTED_VERBS.has(previousWord)) return true;

  let cursor = sourceIndex - 1;
  while (cursor >= 1 && words[cursor] === "and") {
    cursor -= 1;
    if (!isLikelyPreferredSpellingPersonName(clauseMatches[cursor]?.[0])) return false;
    cursor -= 1;
  }
  if (PREFERRED_SPELLING_ALIAS_PERSON_DIRECTED_VERBS.has(words[cursor])) return true;

  if (!PREFERRED_SPELLING_ALIAS_RECIPIENT_LINKERS.has(previousWord)) return false;
  for (cursor = sourceIndex - 2; cursor >= Math.max(0, sourceIndex - 7); cursor -= 1) {
    if (PREFERRED_SPELLING_ALIAS_PERSON_DIRECTED_VERBS.has(words[cursor])) return true;
    if (PREFERRED_SPELLING_ALIAS_BLOCKED_CONTEXT_WORDS.has(words[cursor])) return false;
  }
  return false;
};

const hasPositivePreferredSpellingPersonContext = (originalText, originalMatches, sourceIndex) => {
  const sourceMatch = originalMatches[sourceIndex];
  if (!sourceMatch) return false;
  const sourceStart = sourceMatch.index || 0;
  const sourceEnd = sourceStart + sourceMatch[0].length;
  const raw = String(originalText || "");
  const clauseBounds = getPreferredSpellingAliasClauseBounds(raw, sourceStart, sourceEnd);
  if (isInsidePreferredSpellingDelimitedSpan(raw, sourceStart, sourceEnd, clauseBounds.start)) {
    return false;
  }

  const clausePrefix = raw.slice(clauseBounds.start, sourceStart);
  const clauseSuffix = raw.slice(sourceEnd, clauseBounds.end);
  const normalizedClausePrefix = normalizeForComparison(clausePrefix);
  const normalizedClauseSuffix = normalizeForComparison(clauseSuffix);
  if (
    PREFERRED_SPELLING_ALIAS_PRESERVATION_PREFIX.test(normalizedClausePrefix) ||
    PREFERRED_SPELLING_ALIAS_PRESERVATION_SUFFIX.test(normalizedClauseSuffix) ||
    PREFERRED_SPELLING_ALIAS_NEGATED_PASSIVE_EDIT_SUFFIX.test(normalizedClauseSuffix)
  ) {
    return false;
  }
  const suffixWords = getWords(clauseSuffix);
  if (
    hasPreferredSpellingTechnicalDefinition(suffixWords) ||
    hasPreferredSpellingTechnicalObjectComplement(suffixWords)
  ) {
    return false;
  }

  const clauseMatches = originalMatches.filter((match) => {
    const start = match.index || 0;
    return start >= clauseBounds.start && start < clauseBounds.end;
  });
  const clauseSourceIndex = clauseMatches.findIndex((match) => (match.index || 0) === sourceStart);
  if (clauseSourceIndex < 0) return false;

  const previousWord = getWords(clauseMatches[clauseSourceIndex - 1]?.[0] || "")[0] || "";
  if (["dear", "hello", "hi"].includes(previousWord)) return true;
  const vocativeActionIndex = suffixWords[0] === "please" ? 1 : 0;
  if (
    clauseSourceIndex === 0 &&
    /^\s*,/u.test(clauseSuffix) &&
    DIRECTIVE_ACTION_OPENERS.has(suffixWords[vocativeActionIndex])
  ) {
    return true;
  }
  return hasDirectedPreferredSpellingPersonContext(clauseMatches, clauseSourceIndex);
};

const isAuditedPreferredSpellingPersonAlias = (
  rawSource,
  rawTarget,
  normalizedSource,
  normalizedTarget
) => {
  if (
    !PREFERRED_SPELLING_ALIAS_NAME_SHAPE.test(rawSource) ||
    !PREFERRED_SPELLING_ALIAS_NAME_SHAPE.test(rawTarget) ||
    normalizedSource !== normalizeForComparison(rawSource) ||
    normalizedTarget !== normalizeForComparison(rawTarget)
  ) {
    return false;
  }
  const sourceCharacters = Array.from(normalizedSource);
  const targetCharacters = Array.from(normalizedTarget);
  return (
    sourceCharacters.length === targetCharacters.length &&
    sourceCharacters.length >= 5 &&
    sourceCharacters.at(-1) === "i" &&
    targetCharacters.at(-1) === "e" &&
    sourceCharacters.slice(0, -1).join("") === targetCharacters.slice(0, -1).join("")
  );
};

export const applyTrustedPreferredSpellingAliases = (
  originalText,
  cleanedText,
  preferredSpellings
) => {
  const canonicalEntries = (Array.isArray(preferredSpellings) ? preferredSpellings : [])
    .map((entry) => ({ entry, tokens: getWords(typeof entry === "string" ? entry : "") }))
    .filter(
      ({ entry, tokens }) =>
        tokens.length === 1 &&
        typeof entry === "string" &&
        PREFERRED_SPELLING_ALIAS_NAME_SHAPE.test(entry)
    )
    .map(({ entry, tokens }) => ({ raw: entry, normalized: tokens[0] }));
  if (canonicalEntries.length === 0) return String(cleanedText || "");
  const originalMatches = Array.from(
    String(originalText || "").matchAll(
      /[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}]|['’‘ʼ](?=[\p{L}\p{M}\p{N}]))*/gu
    )
  );
  const cleaned = String(cleanedText || "");
  const cleanedMatches = Array.from(
    cleaned.matchAll(/[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}]|['’‘ʼ](?=[\p{L}\p{M}\p{N}]))*/gu)
  );
  if (originalMatches.length !== cleanedMatches.length) return cleaned;

  let result = "";
  let cursor = 0;
  for (let index = 0; index < cleanedMatches.length; index += 1) {
    const originalRaw = originalMatches[index][0];
    const cleanedRaw = cleanedMatches[index][0];
    const originalNormalized = getWords(originalRaw)[0] || "";
    const cleanedNormalized = getWords(cleanedRaw)[0] || "";
    const possibleTargets = canonicalEntries.filter(
      (target) =>
        isAuthorizedPreferredSpellingSource(
          originalRaw,
          target.raw,
          originalNormalized,
          target.normalized,
          {
            originalText,
            originalMatches,
            sourceIndex: index,
          }
        ) &&
        (cleanedNormalized === originalNormalized || cleanedNormalized === target.normalized)
    );
    const matchIndex = cleanedMatches[index].index || 0;
    result += cleaned.slice(cursor, matchIndex);
    result += possibleTargets.length === 1 ? possibleTargets[0].raw : cleanedRaw;
    cursor = matchIndex + cleanedRaw.length;
  }
  return result + cleaned.slice(cursor);
};

const isAuthorizedPreferredSpellingSource = (
  rawSource,
  rawTarget,
  normalizedSource,
  normalizedTarget,
  context
) => {
  if (normalizedSource === normalizedTarget) return false;
  return Boolean(
    isAuditedPreferredSpellingPersonAlias(
      rawSource,
      rawTarget,
      normalizedSource,
      normalizedTarget
    ) &&
    hasPositivePreferredSpellingPersonContext(
      context?.originalText,
      context?.originalMatches || [],
      context?.sourceIndex
    )
  );
};

const getPreferredSpellingAlignment = (preferredSpellings, original, cleaned) => {
  const originalMatches = getRawLexicalTokenMatches(original);
  const originalTokens = originalMatches.map((match) => match[0]);
  const cleanedTokens = getRawLexicalTokens(cleaned);
  const comparisonOriginalRawTokens = [...originalTokens];
  const canonicalEntriesByNormalized = new Map();

  for (const entry of Array.isArray(preferredSpellings) ? preferredSpellings : []) {
    if (typeof entry !== "string") continue;
    const normalizedEntryTokens = getWords(entry);
    if (normalizedEntryTokens.length !== 1) continue;
    if (!canonicalEntriesByNormalized.has(normalizedEntryTokens[0])) {
      canonicalEntriesByNormalized.set(normalizedEntryTokens[0], {
        raw: entry,
        normalized: normalizedEntryTokens[0],
      });
    }
  }

  const corrections = [];
  // A dictionary entry is an exact spelling preference, not a bag-of-words
  // substitution allowance. Only authorize a correction when the source and
  // canonical target occupy the same lexical occurrence. If cleanup inserted
  // or removed a word, the ordinary fidelity checks must judge the result.
  if (originalTokens.length === cleanedTokens.length) {
    for (let index = 0; index < originalTokens.length; index += 1) {
      const rawSource = originalTokens[index];
      const normalizedSourceTokens = getWords(rawSource);
      const normalizedCleanedTokens = getWords(cleanedTokens[index]);
      if (normalizedSourceTokens.length !== 1 || normalizedCleanedTokens.length !== 1) continue;

      const normalizedSource = normalizedSourceTokens[0];
      const normalizedCleaned = normalizedCleanedTokens[0];
      const target = canonicalEntriesByNormalized.get(normalizedCleaned);
      if (
        !target ||
        !isAuthorizedPreferredSpellingSource(
          rawSource,
          target.raw,
          normalizedSource,
          target.normalized,
          {
            originalText: original,
            originalMatches,
            sourceIndex: index,
          }
        )
      ) {
        continue;
      }

      comparisonOriginalRawTokens[index] = target.raw;
      corrections.push({ index, original: normalizedSource, cleaned: target.normalized });
    }
  }
  return {
    comparisonOriginalRawTokens,
    comparisonOriginalWords: comparisonOriginalRawTokens.flatMap((token) => getWords(token)),
    corrections,
  };
};

const getSemanticContentDiff = (originalWords, cleanedWords) => {
  const remainingOriginal = [...originalWords];
  const remainingCleaned = [...cleanedWords];

  for (let index = remainingOriginal.length - 1; index >= 0; index -= 1) {
    const exactIndex = remainingCleaned.indexOf(remainingOriginal[index]);
    if (exactIndex >= 0) {
      remainingOriginal.splice(index, 1);
      remainingCleaned.splice(exactIndex, 1);
    }
  }

  const missingWords = remainingOriginal.filter(isContentWord);
  const addedWords = remainingCleaned.filter(isContentWord);
  return {
    missingWords,
    addedWords,
    missingCount: missingWords.length,
    addedCount: addedWords.length,
  };
};

const getAllowedSpokenFormattingRanges = (value) => {
  const raw = String(value || "");
  const matches = [
    ...raw.matchAll(
      /\b(?:question mark|exclamation (?:mark|point)|full stop|new (?:line|paragraph))\b/gi
    ),
  ];
  const trailing = raw.match(/\b(?:comma|period|colon|semicolon)\s*[.!?]?\s*$/i);
  if (trailing) matches.push(trailing);
  const lexicalMatches = getRawLexicalTokenMatches(raw);
  return matches.map((match) => {
    const start = match.index || 0;
    const end = start + match[0].length;
    const normalized = getWords(match[0]).join(" ");
    const kind =
      normalized === "question mark"
        ? "question"
        : normalized === "exclamation mark" || normalized === "exclamation point"
          ? "exclamation"
          : normalized === "full stop" || normalized === "period"
            ? "period"
            : normalized === "new line"
              ? "new_line"
              : normalized === "new paragraph"
                ? "new_paragraph"
                : normalized;
    const tokenIndexes = lexicalMatches
      .map((tokenMatch, index) => ({
        index,
        start: tokenMatch.index || 0,
        end: (tokenMatch.index || 0) + tokenMatch[0].length,
      }))
      .filter((token) => token.start >= start && token.end <= end)
      .map(({ index }) => index);
    return { start, end, text: match[0], kind, tokenIndexes };
  });
};

const SPOKEN_FORMATTING_BOUNDARY_PATTERNS = {
  question: /\?/u,
  exclamation: /!/u,
  period: /\./u,
  comma: /,/u,
  colon: /:/u,
  semicolon: /;/u,
  new_line: /\r?\n/u,
  new_paragraph: /\r?\n[\t ]*\r?\n/u,
};

const getSingleNormalizedWord = (value) => {
  const words = getWords(value);
  return words.length === 1 ? words[0] : null;
};

const getTokenOccurrenceOrdinal = (tokens, targetIndex, normalizedWord, excludedIndexes) => {
  let ordinal = 0;
  for (let index = 0; index <= targetIndex; index += 1) {
    if (excludedIndexes.has(index)) continue;
    if (getSingleNormalizedWord(tokens[index]) === normalizedWord) ordinal += 1;
  }
  return ordinal;
};

const findTokenOccurrenceIndex = (matches, normalizedWord, ordinal) => {
  let seen = 0;
  for (let index = 0; index < matches.length; index += 1) {
    if (getSingleNormalizedWord(matches[index][0]) !== normalizedWord) continue;
    seen += 1;
    if (seen === ordinal) return index;
  }
  return -1;
};

const SPOKEN_FORMATTING_META_CONTEXT =
  /\b(?:expressions?|labels?|literals?|names?|phrases?|punctuation|symbols?|terms?|wording|words?)\b(?:\s+(?:a|an|as|called|displayed|for|named|of|rendered|shown|spelled|the|typed|written)){0,3}\s*["'“”‘’]*$/iu;
const SPOKEN_FORMATTING_RELATIONAL_SUFFIX =
  /^["'“”‘’]*\s*(?:as|called|displayed|for|from|in|is|means?|named|of|on|refers?|rendered|shown|spelled|to|typed|was|were|with|written)\b/iu;
const SPOKEN_FORMATTING_NAMING_PREFIX =
  /\b(?:(?:am|are|be|been|being|is|was|were)\s+)?(?:called|labelled|labeled|named|titled)\s*["'“”‘’]*$/iu;
const SPOKEN_FORMATTING_MODAL_AUXILIARIES = new Set([
  "can",
  "could",
  "may",
  "might",
  "must",
  "shall",
  "should",
  "will",
  "would",
]);
const SPOKEN_FORMATTING_FINITE_AUXILIARIES = new Set([
  "am",
  "are",
  ...SPOKEN_FORMATTING_MODAL_AUXILIARIES,
  "did",
  "do",
  "does",
  "had",
  "has",
  "have",
  "is",
  "was",
  "were",
]);
const SPOKEN_FORMATTING_QUESTION_WORDS = new Set([
  "how",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
]);
const SPOKEN_FORMATTING_INCOMPLETE_CLAUSE_ENDINGS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);
const SPOKEN_FORMATTING_DIRECT_OBJECT_REQUIRED_ACTIONS = new Set([
  "add",
  "call",
  "define",
  "display",
  "enter",
  "explain",
  "include",
  "insert",
  "keep",
  "label",
  "mention",
  "move",
  "name",
  "output",
  "preserve",
  "print",
  "pronounce",
  "quote",
  "read",
  "remove",
  "render",
  "replace",
  "retain",
  "say",
  "show",
  "spell",
  "title",
  "type",
  "use",
  "write",
]);
const SPOKEN_FORMATTING_EXPLICIT_OBJECT_PRONOUNS = new Set([
  "anything",
  "everything",
  "it",
  "one",
  "ones",
  "something",
  "that",
  "these",
  "this",
  "those",
]);
const SPOKEN_FORMATTING_NON_OBJECT_COMPLEMENTS = new Set([
  "again",
  "aloud",
  "away",
  "back",
  "carefully",
  "clearly",
  "directly",
  "down",
  "here",
  "later",
  "loud",
  "loudly",
  "now",
  "out",
  "over",
  "quietly",
  "slowly",
  "there",
  "today",
  "tomorrow",
  "tonight",
  "up",
  "yesterday",
]);
const SPOKEN_FORMATTING_OBJECT_BOUNDARIES = new Set(["about", "for", "to", "with"]);

const hasExplicitSpokenFormattingDirectObject = (words, actionIndex) => {
  const wordsAfterAction = words.slice(actionIndex + 1);
  const boundaryIndex = wordsAfterAction.findIndex((word) =>
    SPOKEN_FORMATTING_OBJECT_BOUNDARIES.has(word)
  );
  const candidateWords =
    boundaryIndex >= 0 ? wordsAfterAction.slice(0, boundaryIndex) : wordsAfterAction;
  return candidateWords.some((word) => {
    if (SPOKEN_FORMATTING_EXPLICIT_OBJECT_PRONOUNS.has(word)) return true;
    return (
      !CONTENT_STOP_WORDS.has(word) &&
      !SPOKEN_FORMATTING_INCOMPLETE_CLAUSE_ENDINGS.has(word) &&
      !SPOKEN_FORMATTING_NON_OBJECT_COMPLEMENTS.has(word) &&
      !/ly$/u.test(word)
    );
  });
};

const hasCompleteSpokenFormattingAction = (words, actionIndex, hasCompleteEnding) => {
  const action = words[actionIndex] || "";
  if (!action || !hasCompleteEnding) return false;
  if (!SPOKEN_FORMATTING_DIRECT_OBJECT_REQUIRED_ACTIONS.has(action)) return true;
  return hasExplicitSpokenFormattingDirectObject(words, actionIndex);
};

const hasMetalinguisticSpokenFormattingContext = (original, range) => {
  const raw = String(original || "");
  const prefix = raw.slice(Math.max(0, range.start - 140), range.start);
  const suffix = raw.slice(range.end, Math.min(raw.length, range.end + 100));
  const adjacentPrefixCharacter = raw.slice(Math.max(0, range.start - 1), range.start);
  const adjacentSuffixCharacter = raw.slice(range.end, range.end + 1);
  const isQuoted =
    /["'“‘]/u.test(adjacentPrefixCharacter) || /["'”’]/u.test(adjacentSuffixCharacter);
  return (
    isQuoted ||
    SPOKEN_FORMATTING_META_CONTEXT.test(prefix) ||
    SPOKEN_FORMATTING_NAMING_PREFIX.test(prefix) ||
    SPOKEN_FORMATTING_RELATIONAL_SUFFIX.test(suffix)
  );
};

const hasPositiveClosedClauseShape = (value) => {
  const words = getWords(value);
  if (words.length < 2) return false;
  const hasCompleteEnding = !SPOKEN_FORMATTING_INCOMPLETE_CLAUSE_ENDINGS.has(
    words[words.length - 1]
  );

  let actionIndex = 0;
  const hasPoliteOpener = words[actionIndex] === "please";
  if (hasPoliteOpener) actionIndex += 1;
  const hasNegativeDirective = words[actionIndex] === "do" && words[actionIndex + 1] === "not";
  if (hasNegativeDirective) actionIndex += 2;
  if (hasPoliteOpener || hasNegativeDirective) {
    return hasCompleteSpokenFormattingAction(words, actionIndex, hasCompleteEnding);
  }
  if (DIRECTIVE_ACTION_OPENERS.has(words[actionIndex])) {
    return hasCompleteSpokenFormattingAction(words, actionIndex, hasCompleteEnding);
  }

  if (SPOKEN_FORMATTING_MODAL_AUXILIARIES.has(words[0]) && Boolean(words[1])) {
    return hasCompleteSpokenFormattingAction(words, 2, hasCompleteEnding);
  }

  if (SPOKEN_FORMATTING_QUESTION_WORDS.has(words[0])) {
    if (SPOKEN_FORMATTING_MODAL_AUXILIARIES.has(words[1])) {
      const action = words[3] || "";
      return (
        words.length >= 4 &&
        hasCompleteEnding &&
        (!SPOKEN_FORMATTING_DIRECT_OBJECT_REQUIRED_ACTIONS.has(action) ||
          ["what", "which", "who"].includes(words[0]) ||
          hasExplicitSpokenFormattingDirectObject(words, 3))
      );
    }
    if (SPOKEN_FORMATTING_FINITE_AUXILIARIES.has(words[1])) {
      return words.length >= 3 && hasCompleteEnding;
    }
  }

  if (["did", "do", "does"].includes(words[0]) && Boolean(words[1])) {
    return hasCompleteSpokenFormattingAction(words, 2, hasCompleteEnding);
  }

  const finiteAuxiliaryIndex = words.findIndex((word) =>
    SPOKEN_FORMATTING_FINITE_AUXILIARIES.has(word)
  );
  return (
    finiteAuxiliaryIndex >= 0 &&
    words.slice(finiteAuxiliaryIndex + 1).some((word) => Boolean(word)) &&
    hasCompleteEnding
  );
};

const hasPositiveSpokenFormattingCommandContext = (original, range) => {
  const raw = String(original || "");
  if (hasMetalinguisticSpokenFormattingContext(raw, range)) return false;

  const prefix = raw.slice(0, range.start).trim();
  const suffix = raw.slice(range.end).trim();
  const prefixTokens = getRawLexicalTokenMatches(prefix);
  const suffixTokens = getRawLexicalTokenMatches(suffix);

  if (range.kind !== "new_line" && range.kind !== "new_paragraph") {
    // Spoken punctuation is only unambiguous enough to remove when it closes a
    // clause. Mid-clause occurrences are ordinary dictated terminology unless
    // stronger structured input becomes available.
    return (
      suffixTokens.length === 0 && prefixTokens.length >= 2 && hasPositiveClosedClauseShape(prefix)
    );
  }

  // A structural marker must visibly separate two substantial segments. The
  // capitalised right edge is a conservative proxy for a new dictated block;
  // ambiguous lower-case prose fails closed and retains the source text.
  const rightFirstToken = suffixTokens[0]?.[0] || "";
  return (
    prefixTokens.length >= 2 &&
    suffixTokens.length >= 2 &&
    /^[\p{Lu}\p{N}]/u.test(rightFirstToken) &&
    hasPositiveClosedClauseShape(prefix)
  );
};

const hasOccurrenceAlignedFormattingBoundary = (
  original,
  cleaned,
  comparisonOriginalRawTokens,
  range
) => {
  const boundaryPattern = SPOKEN_FORMATTING_BOUNDARY_PATTERNS[range.kind];
  if (!boundaryPattern || range.tokenIndexes.length === 0) return false;
  if (!hasPositiveSpokenFormattingCommandContext(original, range)) return false;

  const excludedIndexes = new Set(range.tokenIndexes);
  const firstMarkerIndex = range.tokenIndexes[0];
  const lastMarkerIndex = range.tokenIndexes[range.tokenIndexes.length - 1];
  const leftSourceIndex = firstMarkerIndex - 1;
  const rightSourceIndex = lastMarkerIndex + 1;
  const cleanedMatches = getRawLexicalTokenMatches(cleaned);
  let leftCleanedIndex = -1;
  let rightCleanedIndex = -1;

  if (leftSourceIndex >= 0) {
    const leftWord = getSingleNormalizedWord(comparisonOriginalRawTokens[leftSourceIndex]);
    if (!leftWord) return false;
    const ordinal = getTokenOccurrenceOrdinal(
      comparisonOriginalRawTokens,
      leftSourceIndex,
      leftWord,
      excludedIndexes
    );
    leftCleanedIndex = findTokenOccurrenceIndex(cleanedMatches, leftWord, ordinal);
    if (leftCleanedIndex < 0) return false;
  }

  if (rightSourceIndex < comparisonOriginalRawTokens.length) {
    const rightWord = getSingleNormalizedWord(comparisonOriginalRawTokens[rightSourceIndex]);
    if (!rightWord) return false;
    const ordinal = getTokenOccurrenceOrdinal(
      comparisonOriginalRawTokens,
      rightSourceIndex,
      rightWord,
      excludedIndexes
    );
    rightCleanedIndex = findTokenOccurrenceIndex(cleanedMatches, rightWord, ordinal);
    if (rightCleanedIndex < 0) return false;
  }

  if (leftCleanedIndex < 0 && rightCleanedIndex < 0) return false;
  if (
    leftCleanedIndex >= 0 &&
    rightCleanedIndex >= 0 &&
    rightCleanedIndex !== leftCleanedIndex + 1
  ) {
    return false;
  }
  if (leftCleanedIndex < 0 && rightCleanedIndex !== 0) return false;

  const boundaryStart =
    leftCleanedIndex >= 0
      ? (cleanedMatches[leftCleanedIndex].index || 0) + cleanedMatches[leftCleanedIndex][0].length
      : 0;
  const boundaryEnd =
    rightCleanedIndex >= 0
      ? cleanedMatches[rightCleanedIndex].index || 0
      : (cleanedMatches[leftCleanedIndex + 1]?.index ?? String(cleaned || "").length);
  return boundaryPattern.test(String(cleaned || "").slice(boundaryStart, boundaryEnd));
};

const getAppliedSpokenFormattingRanges = (original, cleaned, comparisonOriginalRawTokens) =>
  getAllowedSpokenFormattingRanges(original).filter((range) =>
    hasOccurrenceAlignedFormattingBoundary(original, cleaned, comparisonOriginalRawTokens, range)
  );

const getAppliedSpokenFormattingWords = (ranges) =>
  ranges.flatMap(({ text }) => getContentWordTokens(text));

const getAppliedSpokenFormattingTokenIndexes = (ranges) => {
  const indexes = new Set();
  for (const range of ranges) {
    for (const index of range.tokenIndexes) indexes.add(index);
  }
  return indexes;
};

const hasAppendedRequestOutput = (cleaned, requestPrefixWords) => {
  if (requestPrefixWords.length === 0) return false;
  const cleanedWordOccurrences = getRawLexicalTokenMatches(cleaned).flatMap((match) =>
    getWords(match[0]).map((word) => ({
      word,
      end: (match.index || 0) + match[0].length,
    }))
  );
  if (cleanedWordOccurrences.length < requestPrefixWords.length) return false;
  if (!requestPrefixWords.every((word, index) => cleanedWordOccurrences[index]?.word === word)) {
    return false;
  }
  if (cleanedWordOccurrences.length > requestPrefixWords.length) return true;

  const retainedEnd = cleanedWordOccurrences[requestPrefixWords.length - 1]?.end || 0;
  const rawSuffix = String(cleaned || "").slice(retainedEnd);
  // Normal terminal punctuation is cleanup. A residual symbol (for example a
  // check mark used as an answer) is model-added output even without a word.
  return rawSuffix.replace(/[\s.!?,;:…'"“”‘’()[\]{}\-–—]/gu, "").length > 0;
};

const getAllowedStructuralRewriteWords = (original, cleaned) => {
  const allowed = [];
  if (
    /\b(?:ask|check|confirm)\s+whether\b/i.test(String(original || "")) &&
    /\?\s*[”’"']?\s*$/.test(String(cleaned || "").trim())
  ) {
    allowed.push("whether");
  }
  return allowed;
};

const removeAllowedMissingWords = (missingWords, allowedWords) => {
  const remaining = [...missingWords];
  for (const word of allowedWords) {
    const index = remaining.indexOf(word);
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
};

const getAttachmentAnchor = (words, start, direction) => {
  for (let index = start; index >= 0 && index < words.length; index += direction) {
    const word = words[index];
    if (!ATTACHMENT_FUNCTION_WORDS.has(word)) return stemComparableWord(word);
  }
  return "";
};

const getMarkerAttachmentOccurrences = (value, markers) => {
  const words = getWords(value);
  const occurrences = [];
  for (const marker of markers) {
    const markerWords = marker.split(/\s+/);
    for (let index = 0; index <= words.length - markerWords.length; index += 1) {
      if (!markerWords.every((word, offset) => words[index + offset] === word)) continue;
      occurrences.push({
        marker,
        left: getAttachmentAnchor(words, index - 1, -1),
        right: getAttachmentAnchor(words, index + markerWords.length, 1),
      });
    }
  }
  return occurrences;
};

const attachmentAnchorsMatch = (left, right) => left === right;

const countMarkerAttachmentChanges = (original, cleaned, markers) => {
  const originalOccurrences = getMarkerAttachmentOccurrences(original, markers);
  const cleanedOccurrences = getMarkerAttachmentOccurrences(cleaned, markers);
  if (
    originalOccurrences.length === 0 ||
    originalOccurrences.length !== cleanedOccurrences.length
  ) {
    return 0;
  }

  const remaining = [...cleanedOccurrences];
  let changed = 0;
  for (const occurrence of originalOccurrences) {
    const matchIndex = remaining.findIndex(
      (candidate) =>
        candidate.marker === occurrence.marker &&
        attachmentAnchorsMatch(candidate.left, occurrence.left) &&
        attachmentAnchorsMatch(candidate.right, occurrence.right)
    );
    if (matchIndex >= 0) remaining.splice(matchIndex, 1);
    else changed += 1;
  }
  return changed;
};

const getCriticalTokens = (value) => {
  const raw = String(value || "");
  const matches = raw.match(
    /(?:https?:\/\/|www\.)[^\s]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d[\d,.:/%-]*\b/giu
  );
  return Array.from(
    new Set(
      (matches || []).map((token) =>
        token
          .toLowerCase()
          .replace(/[),.;!?]+$/g, "")
          .replace(/,(?=\d)/g, "")
      )
    )
  );
};

const tokenizeTechnicalText = (value) =>
  (String(value || "").match(TECHNICAL_TOKEN_PATTERN) || []).map((token) =>
    token.toLocaleLowerCase()
  );

const getProtectedTechnicalTokens = (value) => {
  const raw = String(value || "");
  const protectedTokens = new Set(
    (raw.match(TECHNICAL_TOKEN_PATTERN) || [])
      .filter(
        (token) =>
          /\d/.test(token) ||
          /[._+:/\\]/.test(token) ||
          (/^[A-Z][A-Z0-9]{1,}$/.test(token) && token.length >= 2)
      )
      .map((token) => token.toLocaleLowerCase())
  );

  for (const match of raw.matchAll(TECHNICAL_CONTEXT_PATTERN)) {
    const token = match[1]?.toLocaleLowerCase();
    if (token && !CONTENT_STOP_WORDS.has(token)) protectedTokens.add(token);
  }

  return protectedTokens;
};

const isWholeOutputQuoted = (value) => {
  const trimmed = String(value || "").trim();
  return WHOLE_OUTPUT_QUOTE_PAIRS.some(
    ([open, close]) =>
      trimmed.length > open.length + close.length &&
      trimmed.startsWith(open) &&
      trimmed.endsWith(close)
  );
};

const countSpokenQuoteMarkers = (value) =>
  (String(value || "").match(SPOKEN_QUOTE_MARKER_GLOBAL) || []).length;

const countQuotationGlyphs = (value) => {
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

const countMarker = (normalizedText, marker) => {
  const matches = normalizedText.match(new RegExp(`\\b${marker}\\b`, "g"));
  return matches?.length || 0;
};

const countPhrase = (normalizedText, phrase) => {
  const padded = ` ${normalizedText} `;
  const target = ` ${phrase} `;
  let count = 0;
  let offset = 0;
  while ((offset = padded.indexOf(target, offset)) >= 0) {
    count += 1;
    offset += target.length;
  }
  return count;
};

const getModalProfile = (value) => {
  const requestOpeners = [];
  const withoutRequestOpeners = String(value || "").replace(
    REQUEST_MODAL_OPENER,
    (_match, boundary, politePrefix, modal, subject) => {
      requestOpeners.push(`${String(modal).toLowerCase()}:${String(subject).toLowerCase()}`);
      return `${boundary}${politePrefix}request ${subject}`;
    }
  );
  const normalized = normalizeForComparison(withoutRequestOpeners);
  const declarativeCounts = Object.fromEntries(
    MODAL_MARKERS.map((marker) => [marker, countMarker(normalized, marker)])
  );
  return { declarativeCounts, requestOpeners };
};

const getSequencedActionVerbs = (normalizedText) =>
  Array.from(
    normalizedText.matchAll(/\b(?:and\s+)?(?:then|subsequently)\s+([\p{L}]+)\b/gu),
    (match) => match[1]
  );

const getGerundBaseCandidates = (word) => {
  if (!word.endsWith("ing") || word.length <= 4) return new Set();

  const stem = word.slice(0, -3);
  const candidates = new Set([stem, `${stem}e`]);
  if (/(.)\1$/u.test(stem)) candidates.add(stem.slice(0, -1));
  if (stem.endsWith("y")) candidates.add(`${stem.slice(0, -1)}ie`);
  return candidates;
};

const hasSequencedVerbFormChange = (normalizedOriginal, normalizedCleaned) => {
  const originalVerbs = getSequencedActionVerbs(normalizedOriginal);
  const cleanedVerbs = getSequencedActionVerbs(normalizedCleaned);

  return originalVerbs.some((originalVerb, index) => {
    const cleanedVerb = cleanedVerbs[index];
    return (
      cleanedVerb &&
      !originalVerb.endsWith("ing") &&
      cleanedVerb.endsWith("ing") &&
      getGerundBaseCandidates(cleanedVerb).has(originalVerb)
    );
  });
};

const startsWithFirstPersonCompletion = (normalizedText) => {
  const words = normalizedText.split(/\s+/).filter(Boolean);
  if (words[0] !== "i") return false;
  if (["did", "completed", "finished"].includes(words[1])) return true;

  let actionIndex = 1;
  if (words[actionIndex] === "have") actionIndex += 1;
  if (["already", "now", "successfully"].includes(words[actionIndex])) actionIndex += 1;
  const action = words[actionIndex] || "";
  return action.endsWith("ed") || IRREGULAR_COMPLETION_VERBS.has(action);
};

const DIRECTIVE_ACTION_OPENERS = new Set([
  "accept",
  "add",
  "analyze",
  "answer",
  "approve",
  "archive",
  "ask",
  "attach",
  "begin",
  "build",
  "buy",
  "call",
  "cancel",
  "change",
  "check",
  "clean",
  "close",
  "compare",
  "complete",
  "configure",
  "connect",
  "continue",
  "copy",
  "create",
  "delete",
  "deploy",
  "describe",
  "diagnose",
  "draft",
  "download",
  "email",
  "edit",
  "enable",
  "ensure",
  "evaluate",
  "explain",
  "file",
  "find",
  "finalize",
  "fix",
  "finish",
  "forward",
  "generate",
  "give",
  "grant",
  "implement",
  "improve",
  "inspect",
  "install",
  "investigate",
  "keep",
  "launch",
  "list",
  "make",
  "mark",
  "merge",
  "monitor",
  "move",
  "notify",
  "open",
  "pause",
  "paste",
  "proceed",
  "publish",
  "push",
  "put",
  "rebuild",
  "record",
  "refactor",
  "reinstall",
  "remove",
  "rename",
  "report",
  "replace",
  "reply",
  "restart",
  "restore",
  "resolve",
  "review",
  "run",
  "save",
  "schedule",
  "search",
  "select",
  "send",
  "set",
  "show",
  "smoke",
  "stop",
  "submit",
  "summarize",
  "take",
  "tell",
  "test",
  "trace",
  "transcribe",
  "try",
  "turn",
  "update",
  "upload",
  "use",
  "verify",
  "wait",
  "write",
]);
const ACTION_QUESTION_OPENER =
  /^(?:how|what|when|where|which|who|why)\s+(?:am|are|can|could|did|do|does|has|have|is|may|might|should|was|were|will|would)\b/;
const PASSIVE_COMPLETION =
  /^(?:(?:the|a|an|this|that|these|those|my|our|your|his|her|its|their)\s+)?(?:[\p{L}\p{N}-]+\s+){0,5}(?:has|have|had|is|are|was|were)\s+(?:already\s+|now\s+|successfully\s+)?(?:been\s+)?[\p{L}-]+(?:ed|en)\b/u;
const THIRD_PERSON_COMPLETION =
  /^(?:(?:he|she|they|it|we|you)|[\p{Lu}][\p{L}'-]*)\s+(?:already\s+|now\s+|successfully\s+)?[\p{L}-]+(?:ed|en)\b/u;
const DECLARATIVE_PAST_COMPLETION =
  /^(?:(?:the|a|an|this|that|these|those|my|our|your|his|her|its|their)\s+)(?:[\p{L}\p{N}'-]+\s+){0,4}[\p{L}-]+(?:ed|en)\b/u;
const ANSWER_STYLE_OPENER =
  /^(?:the\s+(?:answer|result|draft|file|message|request|task)\b|(?:he|she|they|it|we|you)\s+(?:has|have|had|is|are|was|were|did)\b|(?:yes|no)[,\s])/i;
const COPULAR_RESULT_STATE =
  /^(?:(?:all|everything|it|this|that)|(?:the|my|our|your|their)(?:\s+[\p{L}\p{N}'-]+){1,6})\s+(?:is|are|was|were|looks|seems)\s+(?:(?:all|fully|now|successfully)\s+)*(?:active|approved|available|complete|completed|configured|deleted|deployed|done|finished|fixed|installed|merged|operational|published|ready|resolved|saved|sent|set|submitted|successful|updated|uploaded)\b/iu;
const BARE_RESULT_STATE =
  /^(?:(?:all\s+)?(?:complete|completed|done|finished|ready|resolved|set|successful)|completed\s+successfully|success)$/i;

const startsWithActionInstructionOrQuestion = (normalizedText) => {
  if (ACTION_QUESTION_OPENER.test(normalizedText)) return true;
  const words = normalizedText.split(/\s+/).filter(Boolean);
  if (
    ["can", "could", "may", "might", "must", "shall", "should", "would", "will"].includes(
      words[0]
    ) &&
    ["i", "we", "you"].includes(words[1])
  ) {
    return true;
  }
  if (words[0] === "please") return Boolean(words[1]);
  return DIRECTIVE_ACTION_OPENERS.has(words[0]);
};

const startsWithThirdPersonCompletion = (rawText, normalizedText) => {
  if (THIRD_PERSON_COMPLETION.test(String(rawText || "").trim())) return true;
  const words = normalizedText.split(/\s+/).filter(Boolean);
  return words
    .slice(1, 7)
    .some(
      (word) => word.endsWith("ed") || word.endsWith("en") || IRREGULAR_COMPLETION_VERBS.has(word)
    );
};

const isCompletionOrAnswerStyle = (rawText, normalizedText) =>
  startsWithFirstPersonCompletion(normalizedText) ||
  PASSIVE_COMPLETION.test(normalizedText) ||
  startsWithThirdPersonCompletion(rawText, normalizedText) ||
  DECLARATIVE_PAST_COMPLETION.test(normalizedText) ||
  ANSWER_STYLE_OPENER.test(normalizedText) ||
  (!/[?]\s*$/.test(String(rawText || "").trim()) &&
    (COPULAR_RESULT_STATE.test(normalizedText) || BARE_RESULT_STATE.test(normalizedText)));

/**
 * Apply a deliberately conservative, content-free acceptance check to AI cleanup output.
 * It catches gross compression, prompt execution, and loss of high-risk literals while
 * leaving nuanced language judgment to the cleanup model and review evals.
 */
export function assessCleanupFidelity(originalText, cleanedText, options = {}) {
  const original = typeof originalText === "string" ? originalText.trim() : "";
  const cleaned = typeof cleanedText === "string" ? cleanedText.trim() : "";
  const originalWords = countWords(original);
  const cleanedWords = countWords(cleaned);
  const wordRatio =
    originalWords > 0 ? cleanedWords / originalWords : cleanedWords === 0 ? 1 : null;
  const reasons = [];

  if (!original) {
    if (cleaned) reasons.push("added-content-to-empty-input");
    return {
      accepted: reasons.length === 0,
      reasons,
      metrics: { originalWords, cleanedWords, wordRatio, contentCoverage: 1 },
    };
  }

  if (!cleaned) {
    reasons.push("empty-output");
  }

  if (cleaned && /<\/?echodraft_[^>]+>/i.test(cleaned)) {
    reasons.push("wrapper-leak");
  }

  if (
    cleaned &&
    isWholeOutputQuoted(cleaned) &&
    !isWholeOutputQuoted(original) &&
    !SPOKEN_QUOTE_MARKER.test(original)
  ) {
    reasons.push("added-whole-output-quotation");
  }

  const spokenQuoteMarkerCount = countSpokenQuoteMarkers(original);
  if (
    cleaned &&
    spokenQuoteMarkerCount >= 2 &&
    countQuotationGlyphs(cleaned) > spokenQuoteMarkerCount
  ) {
    reasons.push("nested-quotation-inference");
  }

  if (
    cleaned &&
    ASSISTANT_ACTION_OPENERS.some((pattern) => pattern.test(cleaned)) &&
    !ASSISTANT_ACTION_OPENERS.some((pattern) => pattern.test(original))
  ) {
    reasons.push("assistant-action-output");
  }

  if (cleaned && hasGovernedExplicitQuoteAttachment(original, cleaned)) {
    reasons.push("quote-attachment-risk");
  }

  // Short and medium dictations have little redundancy: losing even a single
  // clause can still leave deceptively high lexical overlap. Route suspicious
  // compression through the strict-preservation retry instead of accepting a
  // polished summary. Longer dictations receive a little more room for genuine
  // filler and immediate-repetition removal.
  if (originalWords >= 20 && wordRatio !== null && wordRatio < (originalWords < 80 ? 0.82 : 0.75)) {
    reasons.push("material-compression");
  } else if (
    originalWords >= 8 &&
    wordRatio !== null &&
    wordRatio < (CLEAR_SELF_CORRECTION.test(original) ? 0.55 : 0.65)
  ) {
    reasons.push("material-compression");
  }

  if (
    originalWords >= 8 &&
    wordRatio !== null &&
    wordRatio > 1.8 &&
    cleanedWords - originalWords >= 30
  ) {
    reasons.push("material-expansion");
  }

  const normalizedOriginal = normalizeForComparison(original);
  const normalizedCleaned = normalizeForComparison(cleaned);
  const explicitQuoteRewrite = SPOKEN_QUOTE_MARKER.test(original);
  const completedWorkflowRepair =
    INCOMPLETE_WORKFLOW_PROGRESSION.test(original) && COMPLETED_WORKFLOW_PROGRESSION.test(cleaned);
  const repairedRequestReason =
    /\?\s+because\b/i.test(original) && /\?\s+i\s+am\s+asking\s+because\b/i.test(cleaned);
  const normalizedCleanedWords = getWords(cleaned);
  const preferredSpellingAlignment = getPreferredSpellingAlignment(
    options.preferredSpellings,
    original,
    cleaned
  );
  // Compare phrase order against an occurrence-bound equivalent of the source.
  // Otherwise an approved canonical spelling repair changes both adjacent
  // bigrams and can look like a clause reorder to the attachment guard.
  const comparisonOriginalWords = preferredSpellingAlignment.comparisonOriginalWords;
  const appliedSpokenFormattingRanges = getAppliedSpokenFormattingRanges(
    original,
    cleaned,
    preferredSpellingAlignment.comparisonOriginalRawTokens
  );
  const originalContentWords = new Set(comparisonOriginalWords.filter(isContentWord));
  const cleanedContentWords = getContentWords(cleaned);
  const comparisonOriginalContentWords = new Set(comparisonOriginalWords.filter(isContentWord));
  const uniqueSemanticContentDiff = getSemanticContentDiff(
    originalContentWords,
    cleanedContentWords
  );
  const occurrenceSemanticContentDiff = getSemanticContentDiff(
    comparisonOriginalWords,
    normalizedCleanedWords
  );
  const substantiveMissingWords = removeAllowedMissingWords(
    occurrenceSemanticContentDiff.missingWords,
    [
      ...getAppliedSpokenFormattingWords(appliedSpokenFormattingRanges),
      ...getAllowedStructuralRewriteWords(original, cleaned),
    ]
  );
  const semanticContentDiff = {
    missingCount: substantiveMissingWords.length,
    addedCount: occurrenceSemanticContentDiff.addedCount,
  };
  const semanticallyRetainedContentWords =
    originalContentWords.size - uniqueSemanticContentDiff.missingCount;
  const semanticContentUnion =
    originalContentWords.size + cleanedContentWords.size - semanticallyRetainedContentWords;
  const semanticContentOverlap =
    semanticContentUnion > 0 ? semanticallyRetainedContentWords / semanticContentUnion : 1;
  const cleanedIsBareResultState = BARE_RESULT_STATE.test(normalizedCleaned);
  const cleanedRetainsDirectiveOrQuestion =
    startsWithActionInstructionOrQuestion(normalizedCleaned) || cleaned.includes("?");
  const isShortLowOverlapDeclarative =
    cleanedWords > 0 &&
    cleanedWords <= 12 &&
    !cleanedRetainsDirectiveOrQuestion &&
    originalContentWords.size > 0 &&
    semanticContentOverlap <= 0.25;
  if (
    startsWithActionInstructionOrQuestion(normalizedOriginal) &&
    normalizedOriginal !== normalizedCleaned &&
    (((!startsWithActionInstructionOrQuestion(normalizedCleaned) || cleanedIsBareResultState) &&
      isCompletionOrAnswerStyle(cleaned, normalizedCleaned)) ||
      isShortLowOverlapDeclarative)
  ) {
    reasons.push("request-execution-output");
  }
  const originalIsDirectiveOrQuestion =
    startsWithActionInstructionOrQuestion(normalizedOriginal) || original.includes("?");
  const spokenFormattingTokenIndexes = getAppliedSpokenFormattingTokenIndexes(
    appliedSpokenFormattingRanges
  );
  const requestPrefixWords = preferredSpellingAlignment.comparisonOriginalRawTokens
    .filter((_token, index) => !spokenFormattingTokenIndexes.has(index))
    .flatMap((token) => getWords(token));
  if (originalIsDirectiveOrQuestion && hasAppendedRequestOutput(cleaned, requestPrefixWords)) {
    // An answer appended after a faithfully retained request is still execution.
    // Short/numeric suffixes are intentionally covered because semantic-word
    // filters often omit exactly the model-added outputs "OK", "No", or "4".
    reasons.push("request-execution-output");
  }
  const approvedStructuralAddition =
    semanticContentDiff.missingCount === 0 &&
    semanticContentDiff.addedCount <= 2 &&
    (completedWorkflowRepair || repairedRequestReason);
  if (
    (semanticContentDiff.missingCount > 0 || semanticContentDiff.addedCount > 0) &&
    !CLEAR_SELF_CORRECTION.test(original) &&
    !explicitQuoteRewrite &&
    !approvedStructuralAddition
  ) {
    reasons.push("substantive-rewrite-risk");
  }
  const paddedNormalizedCleaned = ` ${normalizedCleaned} `;
  const criticalTokens = getCriticalTokens(original);
  const missingCriticalTokens = criticalTokens.filter(
    (token) => !paddedNormalizedCleaned.includes(` ${normalizeForComparison(token)} `)
  );
  if (missingCriticalTokens.length > 0) {
    reasons.push("critical-token-loss");
  }

  const protectedTechnicalTokens = getProtectedTechnicalTokens(original);
  const cleanedTechnicalTokens = new Set(tokenizeTechnicalText(cleaned));
  const missingProtectedTechnicalTokens = [...protectedTechnicalTokens].filter(
    (token) => !cleanedTechnicalTokens.has(token)
  );
  if (missingProtectedTechnicalTokens.length > 0) {
    reasons.push("technical-token-change");
  }

  const changedNegations = NEGATION_MARKERS.filter(
    (marker) => countMarker(normalizedCleaned, marker) !== countMarker(normalizedOriginal, marker)
  );
  if (changedNegations.length > 0) {
    const lostNegation = changedNegations.some(
      (marker) => countMarker(normalizedCleaned, marker) < countMarker(normalizedOriginal, marker)
    );
    const addedNegation = changedNegations.some(
      (marker) => countMarker(normalizedCleaned, marker) > countMarker(normalizedOriginal, marker)
    );
    if (lostNegation) reasons.push("negation-loss");
    if (addedNegation) reasons.push("negation-addition");
  }
  const changedNegationAttachmentCount = explicitQuoteRewrite
    ? 0
    : countMarkerAttachmentChanges(original, cleaned, NEGATION_MARKERS);
  if (changedNegationAttachmentCount > 0) {
    reasons.push("negation-attachment-change");
  }

  const changedRelations = RELATION_MARKERS.filter(
    (marker) => countMarker(normalizedCleaned, marker) !== countMarker(normalizedOriginal, marker)
  );
  if (changedRelations.length > 0) {
    if (
      changedRelations.some(
        (marker) => countMarker(normalizedCleaned, marker) < countMarker(normalizedOriginal, marker)
      )
    ) {
      reasons.push("relation-marker-loss");
    }
    if (
      changedRelations.some(
        (marker) => countMarker(normalizedCleaned, marker) > countMarker(normalizedOriginal, marker)
      )
    ) {
      reasons.push("relation-marker-addition");
    }
  }
  const relationAttachmentMarkers = RELATION_MARKERS.filter(
    (marker) =>
      !(completedWorkflowRepair && marker === "then") &&
      !(repairedRequestReason && marker === "because")
  );
  const changedRelationAttachmentCount = explicitQuoteRewrite
    ? 0
    : countMarkerAttachmentChanges(original, cleaned, relationAttachmentMarkers);
  if (changedRelationAttachmentCount > 0) {
    reasons.push("relation-attachment-change");
  }

  const changedStanceMarkers = STANCE_MARKERS.filter(
    (marker) => countMarker(normalizedCleaned, marker) !== countMarker(normalizedOriginal, marker)
  );
  const changedStancePhrases = STANCE_PHRASES.filter(
    (phrase) => countPhrase(normalizedCleaned, phrase) !== countPhrase(normalizedOriginal, phrase)
  );
  const stanceChanges = [
    ...changedStanceMarkers.map((marker) => ({
      cleaned: countMarker(normalizedCleaned, marker),
      original: countMarker(normalizedOriginal, marker),
    })),
    ...changedStancePhrases.map((phrase) => ({
      cleaned: countPhrase(normalizedCleaned, phrase),
      original: countPhrase(normalizedOriginal, phrase),
    })),
  ];
  if (stanceChanges.some(({ cleaned, original }) => cleaned < original)) {
    reasons.push("stance-marker-loss");
  }
  if (stanceChanges.some(({ cleaned, original }) => cleaned > original)) {
    reasons.push("stance-marker-addition");
  }
  const changedStanceAttachmentCount = explicitQuoteRewrite
    ? 0
    : countMarkerAttachmentChanges(original, cleaned, [...STANCE_MARKERS, ...STANCE_PHRASES]);
  if (changedStanceAttachmentCount > 0) {
    reasons.push("stance-attachment-change");
  }

  const originalModalProfile = getModalProfile(original);
  const cleanedModalProfile = getModalProfile(cleaned);
  const changedModalMarkers = MODAL_MARKERS.filter(
    (marker) =>
      originalModalProfile.declarativeCounts[marker] !==
      cleanedModalProfile.declarativeCounts[marker]
  );
  if (changedModalMarkers.length > 0) {
    reasons.push("modal-certainty-change");
  }
  if (
    originalModalProfile.requestOpeners.length !== cleanedModalProfile.requestOpeners.length ||
    originalModalProfile.requestOpeners.some(
      (opener, index) => opener !== cleanedModalProfile.requestOpeners[index]
    )
  ) {
    reasons.push("request-modality-change");
  }
  const changedModalAttachmentCount = explicitQuoteRewrite
    ? 0
    : countMarkerAttachmentChanges(original, cleaned, MODAL_MARKERS);
  if (changedModalAttachmentCount > 0) {
    reasons.push("modal-attachment-change");
  }

  if (hasSequencedVerbFormChange(normalizedOriginal, normalizedCleaned)) {
    reasons.push("relation-verb-form-change");
  }

  if (
    INCOMPLETE_WORKFLOW_PROGRESSION.test(original) &&
    INCOMPLETE_WORKFLOW_PROGRESSION.test(cleaned)
  ) {
    reasons.push("incomplete-workflow-progression");
  }

  if (original.includes("?") && !cleaned.includes("?")) {
    reasons.push("question-loss");
  }

  const orderedBigramRetention = getOrderedBigramRetention(
    comparisonOriginalWords,
    normalizedCleanedWords
  );
  let retainedContentWords = 0;
  for (const word of comparisonOriginalContentWords) {
    if (cleanedContentWords.has(word)) retainedContentWords += 1;
  }
  let retainedCleanedContentWords = 0;
  for (const word of cleanedContentWords) {
    if (comparisonOriginalContentWords.has(word)) retainedCleanedContentWords += 1;
  }
  const contentCoverage =
    comparisonOriginalContentWords.size > 0
      ? retainedContentWords / comparisonOriginalContentWords.size
      : 1;
  const contentPrecision =
    cleanedContentWords.size > 0
      ? retainedCleanedContentWords / cleanedContentWords.size
      : comparisonOriginalContentWords.size === 0
        ? 1
        : 0;
  const missingContentWordCount = comparisonOriginalContentWords.size - retainedContentWords;
  const addedContentWordCount = cleanedContentWords.size - retainedCleanedContentWords;
  if (originalWords >= 20 && contentCoverage < 0.6) {
    reasons.push("low-content-word-coverage");
  }
  // Short and medium dictations can preserve every topic word while moving a
  // qualifier, list item, or clause into a different attachment. Low phrase-
  // order retention is sufficient evidence of that risk even when the word set
  // is unchanged. Route it through strict preservation; if the retry remains
  // risky, the caller falls back to the original transcript.
  if (
    originalWords >= 12 &&
    originalWords < 40 &&
    !CLEAR_SELF_CORRECTION.test(original) &&
    !SPOKEN_QUOTE_MARKER.test(original) &&
    orderedBigramRetention < 0.9
  ) {
    reasons.push("attachment-rewrite-risk");
  }
  if (
    originalWords >= 40 &&
    (contentCoverage < 0.9 ||
      orderedBigramRetention < 0.8 ||
      (!CLEAR_SELF_CORRECTION.test(original) &&
        originalWords >= 60 &&
        (semanticContentDiff.missingCount > 3 || semanticContentDiff.addedCount > 1)))
  ) {
    reasons.push("high-rewrite-risk");
  }

  return {
    accepted: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
    metrics: {
      originalWords,
      cleanedWords,
      wordRatio,
      contentCoverage,
      contentPrecision,
      missingContentWordCount,
      addedContentWordCount,
      semanticMissingContentWordCount: semanticContentDiff.missingCount,
      semanticAddedContentWordCount: semanticContentDiff.addedCount,
      preferredSpellingCorrectionCount: preferredSpellingAlignment.corrections.length,
      orderedBigramRetention,
      criticalTokenCount: criticalTokens.length,
      missingCriticalTokenCount: missingCriticalTokens.length,
      protectedTechnicalTokenCount: protectedTechnicalTokens.size,
      missingProtectedTechnicalTokenCount: missingProtectedTechnicalTokens.length,
      changedStanceMarkerCount: stanceChanges.length,
      changedModalMarkerCount: changedModalMarkers.length,
      changedNegationAttachmentCount,
      changedRelationAttachmentCount,
      changedStanceAttachmentCount,
      changedModalAttachmentCount,
    },
  };
}

export class CleanupFidelityError extends Error {
  constructor(assessment) {
    super("Cleanup output failed the preservation check; the original transcript was kept.");
    this.name = "CleanupFidelityError";
    this.code = "CLEANUP_FIDELITY_REJECTED";
    this.assessment = assessment;
  }
}
