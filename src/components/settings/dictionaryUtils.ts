import {
  MAX_STORED_DICTIONARY_ENTRIES as SHARED_MAX_STORED_DICTIONARY_ENTRIES,
  MAX_USER_DICTIONARY_ENTRIES as SHARED_MAX_USER_DICTIONARY_ENTRIES,
  sanitizeLexicalDictionaryEntries,
} from "../../utils/dictionaryLexicon.cjs";

const DICTIONARY_SPLIT_REGEX = /[\n,;\t]+/g;
const MAX_DICTIONARY_ENTRY_LENGTH = 80;
export const MAX_USER_DICTIONARY_ENTRIES = SHARED_MAX_USER_DICTIONARY_ENTRIES;
export const MAX_STORED_DICTIONARY_ENTRIES = SHARED_MAX_STORED_DICTIONARY_ENTRIES;

export const normalizeDictionaryEntry = (entry: string): string | null =>
  sanitizeLexicalDictionaryEntries([entry], {
    maxEntries: 1,
    maxEntryLength: MAX_DICTIONARY_ENTRY_LENGTH,
    maxWords: 1,
  })[0] || null;

export const parseDictionaryEntries = (input: string): string[] =>
  input
    .split(DICTIONARY_SPLIT_REGEX)
    .map((entry) => entry.trim())
    .filter(Boolean);

export const dedupeDictionaryEntries = (
  entries: string[],
  maxEntries = MAX_USER_DICTIONARY_ENTRIES
): string[] =>
  sanitizeLexicalDictionaryEntries(entries, {
    maxEntries,
    maxEntryLength: MAX_DICTIONARY_ENTRY_LENGTH,
    maxWords: 1,
  });

export const getFileNameFromPath = (filePath = ""): string => {
  if (!filePath) return "";
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
};
