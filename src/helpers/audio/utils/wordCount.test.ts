import { describe, expect, it } from "vitest";

import { countWords } from "./wordCount.js";

describe("countWords", () => {
  it("returns 0 for non-strings", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords(null as any)).toBe(0);
    expect(countWords(undefined as any)).toBe(0);
    expect(countWords(123 as any)).toBe(0);
  });

  it("counts whitespace-separated words", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords(" hello   world ")).toBe(2);
    expect(countWords("one\ntwo\tthree")).toBe(3);
  });
});

