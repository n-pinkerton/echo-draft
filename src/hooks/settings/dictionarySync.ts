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
  | { action: "noop"; dbCount: number; localCount: number }
  | { action: "failed"; error: string };

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

    if (dbWords.length === 0 && localWords.length > 0 && electronAPI.setDictionary) {
      await electronAPI.setDictionary(localWords);
      return { action: "seeded-db", seededCount: localWords.length };
    }

    if (dbWords.length > 0 && localWords.length === 0) {
      setLocalWords(dbWords);
      return { action: "restored-local", restoredCount: dbWords.length };
    }

    return { action: "noop", dbCount: dbWords.length, localCount: localWords.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log?.warn?.("Failed to sync dictionary on startup", { error }, "settings");
    return { action: "failed", error };
  }
}
