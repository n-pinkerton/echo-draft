const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_ENTRY_LENGTH = 80;
const MAX_ENTRY_WORDS = 1;

const SAFE_LEXICAL_ENTRY = /^[\p{L}\p{N}][\p{L}\p{N} .+'’#&%/_-]*$/u;

function normalizeLexicalDictionaryEntry(
  value,
  maxLength = DEFAULT_MAX_ENTRY_LENGTH,
  { maxWords = MAX_ENTRY_WORDS } = {}
) {
  if (typeof value !== "string") return null;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return null;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    !SAFE_LEXICAL_ENTRY.test(normalized) ||
    normalized.split(" ").length > maxWords
  ) {
    return null;
  }
  return normalized;
}

function sanitizeLexicalDictionaryEntries(
  entries,
  {
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxEntryLength = DEFAULT_MAX_ENTRY_LENGTH,
    maxWords = MAX_ENTRY_WORDS,
  } = {}
) {
  const seen = new Set();
  const result = [];
  for (const candidate of Array.isArray(entries) ? entries : []) {
    const entry = normalizeLexicalDictionaryEntry(candidate, maxEntryLength, { maxWords });
    if (!entry) continue;
    const key = entry.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
    if (result.length >= maxEntries) break;
  }
  return result;
}

module.exports = {
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_ENTRY_LENGTH,
  normalizeLexicalDictionaryEntry,
  sanitizeLexicalDictionaryEntries,
};
