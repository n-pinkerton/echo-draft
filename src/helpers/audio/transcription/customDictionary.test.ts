import { describe, expect, it } from "vitest";

import { getCustomDictionaryArray, getCustomDictionaryPrompt } from "./customDictionary.js";

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
});

