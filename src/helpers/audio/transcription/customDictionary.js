/**
 * Custom dictionary helpers.
 *
 * The UI stores the dictionary in `localStorage.customDictionary` as JSON:
 * `["Term A", "Term B", ...]`
 *
 * Keeping this logic in one place avoids subtle inconsistencies between providers.
 */

import { sanitizeLexicalDictionaryEntries } from "../../../utils/dictionaryLexicon.cjs";

const MAX_DICTIONARY_ENTRIES = 200;
const MAX_ENTRY_LENGTH = 80;

const sanitizeDictionaryEntries = (entries = []) =>
  sanitizeLexicalDictionaryEntries(entries, {
    maxEntries: MAX_DICTIONARY_ENTRIES,
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
 * - Cloud transcription free-text prompts are intentionally disabled. Even a comma-separated
 *   token list is still natural-language prompt content and can corrupt a transcript.
 * - Structured provider context-bias fields are handled separately by their provider adapter.
 *
 * @param {{
 *   model?: string,
 *   entries?: string[],
 * }} options
 * @returns {{ prompt: string | null, entriesUsed: string[], mode: "none" | "disabled-cloud" }}
 */
export function buildCustomDictionaryPromptForTranscription(options = {}) {
  const model = options?.model || "";
  const rawEntries = Array.isArray(options?.entries) ? options.entries : [];
  const entries = sanitizeDictionaryEntries(rawEntries);

  if (entries.length === 0) {
    return { prompt: null, entriesUsed: [], mode: "none" };
  }

  void model;
  return { prompt: null, entriesUsed: [], mode: "disabled-cloud" };
}
