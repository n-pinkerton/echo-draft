const MAX_CLEANUP_TITLE_LENGTH = 100;

const JSON_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
const LABELLED_CONTRACT_PATTERN =
  /^\s*title\s*:\s*[^\r\n]*\r?\n\s*(?:cleaned\s+dictation|dictation|text)\s*:\s*([\s\S]*)$/i;
const MALFORMED_CONTRACT_PREFIX =
  /^\{\s*"title"\s*:\s*"(?:\\.|[^"\\])*"\s*,\s*"text"\s*:\s*/i;

const normalizeCleanupTitle = (value) => {
  if (typeof value !== "string") return null;
  const title = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\u2014/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return title && title.length <= MAX_CLEANUP_TITLE_LENGTH ? title : null;
};

const parseJsonStringAt = (source, start) => {
  if (source[start] !== '"') return null;
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      try {
        const value = JSON.parse(source.slice(start, index + 1));
        return typeof value === "string" ? value : null;
      } catch {
        return null;
      }
    }
  }
  return null;
};

const recoverTextField = (source) => {
  const match = MALFORMED_CONTRACT_PREFIX.exec(source);
  if (!match) return null;
  return parseJsonStringAt(source, match[0].length);
};

const parseContractObject = (value) => {
  const text = typeof value?.text === "string" ? value.text : "";
  const title = normalizeCleanupTitle(value?.title);
  const keys = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
  const contractSucceeded =
    keys.length === 2 && keys[0] === "text" && keys[1] === "title" && title !== null;

  return {
    text,
    title: contractSucceeded ? title : null,
    contractSucceeded,
  };
};

const parseCleanupOutput = (candidate, originalText) => {
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    return parseContractObject(candidate);
  }

  const raw = typeof candidate === "string" ? candidate : String(candidate ?? "");
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(JSON_FENCE_PATTERN);
  const structuredCandidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  if (structuredCandidate) {
    try {
      const parsed = JSON.parse(structuredCandidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parseContractObject(parsed);
      }
      if (typeof parsed === "string") {
        return { text: parsed, title: null, contractSucceeded: false };
      }
    } catch {
      const recoveredText = recoverTextField(structuredCandidate);
      if (recoveredText !== null) {
        return { text: recoveredText, title: null, contractSucceeded: false };
      }

      const labelledText = structuredCandidate.match(LABELLED_CONTRACT_PATTERN)?.[1];
      const originalIsLabelled =
        typeof originalText === "string" && LABELLED_CONTRACT_PATTERN.test(originalText);
      if (
        typeof labelledText === "string" &&
        typeof originalText === "string" &&
        !originalIsLabelled
      ) {
        return {
          text: labelledText,
          title: null,
          contractSucceeded: false,
          formatRecovery: { kind: "labelled", originalOutput: raw },
        };
      }
    }
  }

  return { text: raw, title: null, contractSucceeded: false };
};

module.exports = {
  MAX_CLEANUP_TITLE_LENGTH,
  normalizeCleanupTitle,
  parseCleanupOutput,
};
