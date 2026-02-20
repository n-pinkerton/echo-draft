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

  it("noops when both sides are already populated", async () => {
    const result = await syncDictionaryOnStartup({
      electronAPI: {
        getDictionary: async () => ["db"],
      },
      localWords: ["local"],
      setLocalWords: vi.fn(),
    });

    expect(result).toEqual({ action: "noop", dbCount: 1, localCount: 1 });
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

