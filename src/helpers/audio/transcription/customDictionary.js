/**
 * Custom dictionary helpers.
 *
 * The UI stores the dictionary in `localStorage.customDictionary` as JSON:
 * `["Term A", "Term B", ...]`
 *
 * Keeping this logic in one place avoids subtle inconsistencies between providers.
 */

/**
 * @param {{ getItem: (key: string) => string | null } | null | undefined} storage
 * @returns {string[]}
 */
export function getCustomDictionaryArray(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    const raw = storage?.getItem?.("customDictionary");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
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

