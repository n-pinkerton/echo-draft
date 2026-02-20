const DICTIONARY_SPLIT_REGEX = /[\n,;\t]+/g;

export const parseDictionaryEntries = (input: string): string[] =>
  input
    .split(DICTIONARY_SPLIT_REGEX)
    .map((entry) => entry.trim())
    .filter(Boolean);

export const dedupeDictionaryEntries = (entries: string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const normalized = trimmed.toLocaleLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(trimmed);
  }
  return unique;
};

export const getFileNameFromPath = (filePath = ""): string => {
  if (!filePath) return "";
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
};

