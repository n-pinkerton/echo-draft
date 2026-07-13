import { countWords } from "../utils/wordCount";
import { BUILT_IN_CLEANUP_DICTIONARY } from "../../../config/prompts";
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

const getWords = (value) => normalizeForComparison(value).split(/\s+/).filter(Boolean);

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

const isEditDistanceAtMostOne = (left, right) => {
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left === right) return true;

  if (left.length === right.length) {
    const firstDifference = [...left].findIndex((character, index) => character !== right[index]);
    if (firstDifference < 0) return true;
    if (left.slice(firstDifference + 1) === right.slice(firstDifference + 1)) return true;
    return (
      firstDifference + 1 < left.length &&
      left[firstDifference] === right[firstDifference + 1] &&
      left[firstDifference + 1] === right[firstDifference] &&
      left.slice(firstDifference + 2) === right.slice(firstDifference + 2)
    );
  }

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else rightIndex += 1;
  }
  if (leftIndex < left.length || rightIndex < right.length) edits += 1;
  return edits <= 1;
};

const areLikelyInflectionOrSpellingVariants = (left, right) =>
  stemComparableWord(left) === stemComparableWord(right) ||
  (left.length >= 5 && right.length >= 5 && isEditDistanceAtMostOne(left, right));

const getAsciiSoundex = (value) => {
  const letters = String(value || "")
    .normalize("NFKD")
    .replace(/[^a-z]/gi, "")
    .toUpperCase();
  if (!letters) return "";

  const codes = {
    B: "1",
    F: "1",
    P: "1",
    V: "1",
    C: "2",
    G: "2",
    J: "2",
    K: "2",
    Q: "2",
    S: "2",
    X: "2",
    Z: "2",
    D: "3",
    T: "3",
    L: "4",
    M: "5",
    N: "5",
    R: "6",
  };
  let output = letters[0];
  let previousCode = codes[letters[0]] || "";
  for (const letter of letters.slice(1)) {
    const code = codes[letter] || "";
    if (code && code !== previousCode) output += code;
    previousCode = code;
    if (output.length === 4) break;
  }
  return `${output}000`.slice(0, 4);
};

const isEditDistanceAtMostTwo = (left, right) => {
  if (Math.abs(left.length - right.length) > 2) return false;
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] =
        left[leftIndex - 1] === right[rightIndex - 1]
          ? previous[rightIndex - 1]
          : 1 + Math.min(previous[rightIndex], current[rightIndex - 1], previous[rightIndex - 1]);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] <= 2;
};

const BUILT_IN_PREFERRED_SPELLING_TOKENS = new Set(
  BUILT_IN_CLEANUP_DICTIONARY.flatMap((entry) => getWords(entry))
);

const getPreferredSpellingTokens = (preferredSpellings) =>
  new Set(
    (Array.isArray(preferredSpellings) ? preferredSpellings : [])
      .flatMap((entry) => getWords(typeof entry === "string" ? entry : ""))
      .filter((entry) => BUILT_IN_PREFERRED_SPELLING_TOKENS.has(entry))
  );

const isPreferredSpellingCorrection = (originalWord, cleanedWord, preferredSpellingTokens) => {
  if (
    !preferredSpellingTokens.has(cleanedWord) ||
    originalWord.length < 4 ||
    cleanedWord.length < 4 ||
    originalWord[0] !== cleanedWord[0] ||
    !isEditDistanceAtMostTwo(originalWord, cleanedWord)
  ) {
    return false;
  }
  const originalSoundex = getAsciiSoundex(originalWord);
  return Boolean(originalSoundex) && originalSoundex === getAsciiSoundex(cleanedWord);
};

const getSemanticContentDiff = (originalWords, cleanedWords, preferredSpellingTokens = new Set()) => {
  const remainingOriginal = [...originalWords];
  const remainingCleaned = [...cleanedWords];
  const preferredSpellingCorrections = [];

  for (let index = remainingOriginal.length - 1; index >= 0; index -= 1) {
    const exactIndex = remainingCleaned.indexOf(remainingOriginal[index]);
    if (exactIndex >= 0) {
      remainingOriginal.splice(index, 1);
      remainingCleaned.splice(exactIndex, 1);
    }
  }

  for (let index = remainingOriginal.length - 1; index >= 0; index -= 1) {
    const variantIndex = remainingCleaned.findIndex((candidate) =>
      areLikelyInflectionOrSpellingVariants(remainingOriginal[index], candidate)
    );
    if (variantIndex >= 0) {
      remainingOriginal.splice(index, 1);
      remainingCleaned.splice(variantIndex, 1);
    }
  }

  for (let index = remainingOriginal.length - 1; index >= 0; index -= 1) {
    const variantIndex = remainingCleaned.findIndex((candidate) =>
      isPreferredSpellingCorrection(
        remainingOriginal[index],
        candidate,
        preferredSpellingTokens
      )
    );
    if (variantIndex >= 0) {
      preferredSpellingCorrections.push({
        original: remainingOriginal[index],
        cleaned: remainingCleaned[variantIndex],
      });
      remainingOriginal.splice(index, 1);
      remainingCleaned.splice(variantIndex, 1);
    }
  }

  const missingWords = remainingOriginal.filter(isContentWord);
  const addedWords = remainingCleaned.filter(isContentWord);
  return {
    missingWords,
    addedWords,
    missingCount: missingWords.length,
    addedCount: addedWords.length,
    preferredSpellingCorrections,
  };
};

const getAllowedSpokenFormattingWords = (value) => {
  const raw = String(value || "");
  const matches = [
    ...raw.matchAll(
      /\b(?:question mark|exclamation (?:mark|point)|full stop|new (?:line|paragraph))\b/gi
    ),
  ];
  const trailing = raw.match(/\b(?:comma|period|colon|semicolon)\s*[.!?]?\s*$/i);
  if (trailing) matches.push(trailing);
  return matches.flatMap((match) => getContentWordTokens(match[0]));
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

const attachmentAnchorsMatch = (left, right) =>
  left === right ||
  (Boolean(left) && Boolean(right) && areLikelyInflectionOrSpellingVariants(left, right));

const countMarkerAttachmentChanges = (original, cleaned, markers) => {
  const originalOccurrences = getMarkerAttachmentOccurrences(original, markers);
  const cleanedOccurrences = getMarkerAttachmentOccurrences(cleaned, markers);
  if (originalOccurrences.length === 0 || originalOccurrences.length !== cleanedOccurrences.length) {
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
  return words.slice(1, 7).some(
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
    INCOMPLETE_WORKFLOW_PROGRESSION.test(original) &&
    COMPLETED_WORKFLOW_PROGRESSION.test(cleaned);
  const repairedRequestReason =
    /\?\s+because\b/i.test(original) && /\?\s+i\s+am\s+asking\s+because\b/i.test(cleaned);
  const normalizedOriginalWords = getWords(original);
  const normalizedCleanedWords = getWords(cleaned);
  const preferredSpellingTokens = getPreferredSpellingTokens(options.preferredSpellings);
  const originalContentWords = getContentWords(original);
  const cleanedContentWords = getContentWords(cleaned);
  const uniqueSemanticContentDiff = getSemanticContentDiff(
    originalContentWords,
    cleanedContentWords,
    preferredSpellingTokens
  );
  const occurrenceSemanticContentDiff = getSemanticContentDiff(
    normalizedOriginalWords,
    normalizedCleanedWords,
    preferredSpellingTokens
  );
  const substantiveMissingWords = removeAllowedMissingWords(
    occurrenceSemanticContentDiff.missingWords,
    [
      ...getAllowedSpokenFormattingWords(original),
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
  const preferredSpellingSourceTokens = new Set(
    occurrenceSemanticContentDiff.preferredSpellingCorrections.map(({ original }) => original)
  );
  const missingProtectedTechnicalTokens = [...protectedTechnicalTokens].filter(
    (token) =>
      !cleanedTechnicalTokens.has(token) && !preferredSpellingSourceTokens.has(token)
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
    normalizedOriginalWords,
    normalizedCleanedWords
  );
  let retainedContentWords = 0;
  for (const word of originalContentWords) {
    if (cleanedContentWords.has(word)) retainedContentWords += 1;
  }
  let retainedCleanedContentWords = 0;
  for (const word of cleanedContentWords) {
    if (originalContentWords.has(word)) retainedCleanedContentWords += 1;
  }
  const contentCoverage =
    originalContentWords.size > 0 ? retainedContentWords / originalContentWords.size : 1;
  const contentPrecision =
    cleanedContentWords.size > 0
      ? retainedCleanedContentWords / cleanedContentWords.size
      : originalContentWords.size === 0
        ? 1
        : 0;
  const missingContentWordCount = originalContentWords.size - retainedContentWords;
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
      preferredSpellingCorrectionCount:
        occurrenceSemanticContentDiff.preferredSpellingCorrections.length,
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
