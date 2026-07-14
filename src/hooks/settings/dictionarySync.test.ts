import { describe, expect, it, vi } from "vitest";

import { syncDictionaryOnStartup } from "./dictionarySync";

describe("syncDictionaryOnStartup", () => {
  it("skips when getDictionary is missing", async () => {
    const result = await syncDictionaryOnStartup({
      electronAPI: {},
      localWords: ["a"],
      setLocalWords: vi.fn(),
    });

    expect(result).toEqual({ action: "skipped", reason: "missing-getDictionary" });
  });

  it("seeds SQLite when DB is empty and localStorage has words", async () => {
    const setDictionary = vi.fn(async () => ({}));
    const result = await syncDictionaryOnStartup({
      electronAPI: {
        getDictionary: async () => [],
        setDictionary,
      },
      localWords: ["alpha", "beta"],
      setLocalWords: vi.fn(),
    });

    expect(setDictionary).toHaveBeenCalledWith(["alpha", "beta"]);
    expect(result).toEqual({ action: "seeded-db", seededCount: 2 });
  });

  it("seeds every valid legacy word beyond the provider payload limit", async () => {
    const legacyWords = Array.from({ length: 104 }, (_, index) => `Legacy${index + 1}`);
    legacyWords.push("Rilje");
    const setDictionary = vi.fn(async () => ({}));

    const result = await syncDictionaryOnStartup({
      electronAPI: {
        getDictionary: async () => [],
        setDictionary,
      },
      localWords: legacyWords,
      setLocalWords: vi.fn(),
    });

    expect(setDictionary).toHaveBeenCalledWith(legacyWords);
    expect(result).toEqual({ action: "seeded-db", seededCount: legacyWords.length });
  });

  it("restores localStorage when DB has words and localStorage is empty", async () => {
    const setLocalWords = vi.fn();
    const result = await syncDictionaryOnStartup({
      electronAPI: {
        getDictionary: async () => ["one", "two"],
      },
      localWords: [],
      setLocalWords,
    });

    expect(setLocalWords).toHaveBeenCalledWith(["one", "two"]);
    expect(result).toEqual({ action: "restored-local", restoredCount: 2 });
  });

  it("merges valid SQLite-only words into an already-populated local dictionary", async () => {
    const setLocalWords = vi.fn();
    const setDictionary = vi.fn(async () => ({}));
    const result = await syncDictionaryOnStartup({
      electronAPI: {
        getDictionary: async () => ["db", "Private name", "LOCAL"],
        setDictionary,
      },
      localWords: ["local"],
      setLocalWords,
    });

    expect(setLocalWords).toHaveBeenCalledWith(["local", "db"]);
    expect(setDictionary).toHaveBeenCalledWith(["local", "db"]);
    expect(result).toEqual({ action: "merged-local", addedCount: 1, localCount: 2 });
  });

  it("noops when both sides already contain the same safe words", async () => {
    const setLocalWords = vi.fn();
    const result = await syncDictionaryOnStartup({
      electronAPI: {
        getDictionary: async () => ["Alpha", "Beta"],
      },
      localWords: ["Alpha", "Beta"],
      setLocalWords,
    });

    expect(setLocalWords).not.toHaveBeenCalled();
    expect(result).toEqual({ action: "noop", dbCount: 2, localCount: 2 });
  });

  it("does not restore unsafe legacy database entries", async () => {
    const setLocalWords = vi.fn();
    const result = await syncDictionaryOnStartup({
      electronAPI: {
        getDictionary: async () => ["Private name"],
      },
      localWords: [],
      setLocalWords,
    });

    expect(setLocalWords).not.toHaveBeenCalled();
    expect(result).toEqual({ action: "noop", dbCount: 1, localCount: 0 });
  });

  it("repairs an invalid-only database from valid local words", async () => {
    const setDictionary = vi.fn(async () => ({}));
    const result = await syncDictionaryOnStartup({
      electronAPI: {
        getDictionary: async () => ["Private name"],
        setDictionary,
      },
      localWords: ["Rilje"],
      setLocalWords: vi.fn(),
    });

    expect(setDictionary).toHaveBeenCalledWith(["Rilje"]);
    expect(result).toEqual({ action: "seeded-db", seededCount: 1 });
  });

  it("returns failed and logs when getDictionary throws", async () => {
    const warn = vi.fn();
    const result = await syncDictionaryOnStartup({
      electronAPI: {
        getDictionary: async () => {
          throw new Error("boom");
        },
      },
      localWords: [],
      setLocalWords: vi.fn(),
      log: { warn },
    });

    expect(warn).toHaveBeenCalledWith(
      "Failed to sync dictionary on startup",
      { error: "boom" },
      "settings"
    );
    expect(result).toEqual({ action: "failed", error: "boom" });
  });
});
