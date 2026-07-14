/**
 * Custom dictionary helpers.
 *
 * The UI stores the dictionary in `localStorage.customDictionary` as JSON:
 * `["Term A", "Term B", ...]`
 *
 * Keeping this logic in one place avoids subtle inconsistencies between providers.
 */

import {
  MAX_USER_DICTIONARY_ENTRIES,
  sanitizeLexicalDictionaryEntries,
} from "../../../utils/dictionaryLexicon.cjs";
import {
  BUILT_IN_CLEANUP_DICTIONARY,
  getTrustedCleanupDictionary,
} from "../../../config/cleanupPolicy.cjs";

const MAX_ENTRY_LENGTH = 80;
const MAX_TRUSTED_DICTIONARY_ENTRIES =
  BUILT_IN_CLEANUP_DICTIONARY.length + MAX_USER_DICTIONARY_ENTRIES;

const sanitizeDictionaryEntries = (entries = []) =>
  sanitizeLexicalDictionaryEntries(entries, {
    maxEntries: MAX_USER_DICTIONARY_ENTRIES,
    maxEntryLength: MAX_ENTRY_LENGTH,
    maxWords: 1,
  });

/**
 * @param {{ getItem: (key: string) => string | null } | null | undefined} storage
 * @returns {string[]}
 */
export function getCustomDictionaryArray(
  storage = typeof localStorage !== "undefined" ? localStorage : null
) {
  try {
    const raw = storage?.getItem?.("customDictionary");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sanitizeDictionaryEntries(parsed) : [];
  } catch {
    return [];
  }
}

export function getTrustedTranscriptionDictionaryArray(
  storage = typeof localStorage !== "undefined" ? localStorage : null
) {
  return getTrustedCleanupDictionary(getCustomDictionaryArray(storage));
}

/**
 * @param {{ getItem: (key: string) => string | null } | null | undefined} storage
 * @returns {string|null}
 */
export function getCustomDictionaryPrompt(
  storage = typeof localStorage !== "undefined" ? localStorage : null
) {
  const entries = getCustomDictionaryArray(storage);
  if (entries.length === 0) return null;
  return entries.join(", ");
}

/**
 * Build a provider/model-specific prompt from custom dictionary entries.
 *
 * Notes:
 * - The renderer sends only sanitized lexical entries. The trusted main process constructs
 *   OpenAI's fixed context sentence, so renderer-controlled free text never crosses IPC.
 * - Structured provider context-bias fields are handled separately by their provider adapter.
 *
 * @param {{
 *   model?: string,
 *   entries?: string[],
 * }} options
 * @returns {{ prompt: null, entriesUsed: string[], mode: "none" | "structured-openai" | "disabled-cloud" }}
 */
export function buildCustomDictionaryPromptForTranscription(options = {}) {
  const model = options?.model || "";
  const rawEntries = Array.isArray(options?.entries) ? options.entries : [];
  const entries = sanitizeLexicalDictionaryEntries(rawEntries, {
    maxEntries: MAX_TRUSTED_DICTIONARY_ENTRIES,
    maxEntryLength: MAX_ENTRY_LENGTH,
    maxWords: 1,
  });

  if (entries.length === 0) {
    return { prompt: null, entriesUsed: [], mode: "none" };
  }

  if (model === "gpt-4o-transcribe" || model.startsWith("gpt-4o-mini-transcribe")) {
    return { prompt: null, entriesUsed: entries, mode: "structured-openai" };
  }

  return { prompt: null, entriesUsed: [], mode: "disabled-cloud" };
}
