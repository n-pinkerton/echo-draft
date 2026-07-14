import {
  MAX_STORED_DICTIONARY_ENTRIES,
  sanitizeLexicalDictionaryEntries,
} from "../../utils/dictionaryLexicon.cjs";

type ElectronDictionaryApi = {
  getDictionary?: () => Promise<string[]>;
  setDictionary?: (words: string[]) => Promise<unknown>;
};

type LoggerWarnLike = {
  warn?: (message: string, meta?: any, scope?: string) => unknown;
};

export type DictionarySyncResult =
  | { action: "skipped"; reason: string }
  | { action: "seeded-db"; seededCount: number }
  | { action: "restored-local"; restoredCount: number }
  | { action: "merged-local"; addedCount: number; localCount: number }
  | { action: "noop"; dbCount: number; localCount: number }
  | { action: "failed"; error: string };

const sanitizeDictionary = (words: unknown): string[] =>
  sanitizeLexicalDictionaryEntries(Array.isArray(words) ? words : [], {
    maxEntries: MAX_STORED_DICTIONARY_ENTRIES,
    maxEntryLength: 80,
    maxWords: 1,
  });

const mergeDictionaryWords = (localWords: string[], dbWords: string[]): string[] =>
  sanitizeDictionary([...localWords, ...dbWords]);

export async function syncDictionaryOnStartup({
  electronAPI,
  localWords,
  setLocalWords,
  log,
}: {
  electronAPI: ElectronDictionaryApi | null | undefined;
  localWords: string[];
  setLocalWords: (words: string[]) => void;
  log?: LoggerWarnLike;
}): Promise<DictionarySyncResult> {
  if (!electronAPI?.getDictionary) {
    return { action: "skipped", reason: "missing-getDictionary" };
  }

  try {
    const dbWords = await electronAPI.getDictionary();
    const safeLocalWords = sanitizeDictionary(localWords);
    const safeDbWords = sanitizeDictionary(dbWords);

    if (safeDbWords.length === 0 && safeLocalWords.length > 0 && electronAPI.setDictionary) {
      await electronAPI.setDictionary(safeLocalWords);
      return { action: "seeded-db", seededCount: safeLocalWords.length };
    }

    if (safeDbWords.length > 0 && safeLocalWords.length === 0) {
      setLocalWords(safeDbWords);
      return { action: "restored-local", restoredCount: safeDbWords.length };
    }

    if (safeDbWords.length > 0 && safeLocalWords.length > 0) {
      const mergedWords = mergeDictionaryWords(safeLocalWords, safeDbWords);
      const localChanged =
        mergedWords.length !== safeLocalWords.length ||
        mergedWords.some((word, index) => word !== safeLocalWords[index]);
      const dbChanged =
        mergedWords.length !== safeDbWords.length ||
        mergedWords.some((word, index) => word !== safeDbWords[index]);
      if (dbChanged && electronAPI.setDictionary) {
        await electronAPI.setDictionary(mergedWords);
      }
      if (localChanged) {
        setLocalWords(mergedWords);
        return {
          action: "merged-local",
          addedCount: mergedWords.length - safeLocalWords.length,
          localCount: mergedWords.length,
        };
      }
      if (dbChanged) {
        return { action: "seeded-db", seededCount: mergedWords.length };
      }
    }

    return { action: "noop", dbCount: dbWords.length, localCount: localWords.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log?.warn?.("Failed to sync dictionary on startup", { error }, "settings");
    return { action: "failed", error };
  }
}
