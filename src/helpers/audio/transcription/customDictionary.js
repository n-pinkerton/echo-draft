/**
 * Custom dictionary helpers.
 *
 * The UI stores the dictionary in `localStorage.customDictionary` as JSON:
 * `["Term A", "Term B", ...]`
 *
 * Keeping this logic in one place avoids subtle inconsistencies between providers.
 */

const MAX_DICTIONARY_ENTRIES = 200;
const MAX_ENTRY_LENGTH = 120;
const MAX_KEYWORD_PROMPT_ENTRIES = 60;

const normalizeEntry = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

const dedupeCaseInsensitive = (values = []) => {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
};

const sanitizeDictionaryEntries = (entries = []) =>
  dedupeCaseInsensitive(
    entries
      .map(normalizeEntry)
      .filter(Boolean)
      .map((entry) => (entry.length > MAX_ENTRY_LENGTH ? entry.slice(0, MAX_ENTRY_LENGTH) : entry))
  ).slice(0, MAX_DICTIONARY_ENTRIES);

const normalizeModel = (model) => (typeof model === "string" ? model.trim().toLowerCase() : "");

const isGpt4oTranscriptionModel = (model) => {
  const normalized = normalizeModel(model);
  return normalized.startsWith("gpt-4o");
};

/**
 * @param {{ getItem: (key: string) => string | null } | null | undefined} storage
 * @returns {string[]}
 */
export function getCustomDictionaryArray(storage = typeof localStorage !== "undefined" ? localStorage : null) {
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
export function getCustomDictionaryPrompt(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  const entries = getCustomDictionaryArray(storage);
  if (entries.length === 0) return null;
  return entries.join(", ");
}

/**
 * Build a provider/model-specific prompt from custom dictionary entries.
 *
 * Notes:
 * - For gpt-4o* transcription models we intentionally disable dictionary prompt injection.
 *   In production logs this prevented large prompt echoes and instruction-like hallucinations.
 * - Whisper-style models keep keyword-list prompting (capped) for proper noun biasing.
 *
 * @param {{
 *   model?: string,
 *   entries?: string[],
 * }} options
 * @returns {{ prompt: string | null, entriesUsed: string[], mode: "none" | "disabled-gpt4o" | "keyword-list" }}
 */
export function buildCustomDictionaryPromptForTranscription(options = {}) {
  const model = options?.model || "";
  const rawEntries = Array.isArray(options?.entries) ? options.entries : [];
  const entries = sanitizeDictionaryEntries(rawEntries);

  if (entries.length === 0) {
    return { prompt: null, entriesUsed: [], mode: "none" };
  }

  if (isGpt4oTranscriptionModel(model)) {
    return { prompt: null, entriesUsed: [], mode: "disabled-gpt4o" };
  }

  const entriesUsed = entries.slice(0, MAX_KEYWORD_PROMPT_ENTRIES);
  return {
    prompt: entriesUsed.join(", "),
    entriesUsed,
    mode: "keyword-list",
  };
}
