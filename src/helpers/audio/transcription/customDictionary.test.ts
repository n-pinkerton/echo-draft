import { describe, expect, it } from "vitest";

import {
  buildCustomDictionaryPromptForTranscription,
  getCustomDictionaryArray,
  getCustomDictionaryPrompt,
} from "./customDictionary.js";

describe("customDictionary", () => {
  it("returns [] when missing/invalid", () => {
    const storage = { getItem: () => null };
    expect(getCustomDictionaryArray(storage as any)).toEqual([]);

    const badStorage = { getItem: () => "not-json" };
    expect(getCustomDictionaryArray(badStorage as any)).toEqual([]);

    const notArrayStorage = { getItem: () => JSON.stringify({ a: 1 }) };
    expect(getCustomDictionaryArray(notArrayStorage as any)).toEqual([]);
  });

  it("returns the parsed array when valid", () => {
    const storage = { getItem: () => JSON.stringify(["A", "B"]) };
    expect(getCustomDictionaryArray(storage as any)).toEqual(["A", "B"]);
    expect(getCustomDictionaryPrompt(storage as any)).toBe("A, B");
  });

  it("sanitizes, deduplicates, and trims entries", () => {
    const storage = {
      getItem: () => JSON.stringify(["  Alpha  ", "alpha", "Beta", "", "Gamma   Delta"]),
    };
    expect(getCustomDictionaryArray(storage as any)).toEqual(["Alpha", "Beta", "Gamma Delta"]);
  });

  it("disables dictionary prompt injection for gpt-4o transcription models", () => {
    const result = buildCustomDictionaryPromptForTranscription({
      model: "gpt-4o-transcribe",
      entries: ["Alpha", "Beta"],
    });

    expect(result).toEqual({
      prompt: null,
      entriesUsed: [],
      mode: "disabled-gpt4o",
    });
  });

  it("keeps keyword list prompting for whisper-style models", () => {
    const result = buildCustomDictionaryPromptForTranscription({
      model: "whisper-1",
      entries: ["Alpha", "Beta"],
    });

    expect(result.prompt).toBe("Alpha, Beta");
    expect(result.entriesUsed).toEqual(["Alpha", "Beta"]);
    expect(result.mode).toBe("keyword-list");
  });
});
