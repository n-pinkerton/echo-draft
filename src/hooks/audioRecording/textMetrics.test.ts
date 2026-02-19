import { describe, expect, it } from "vitest";

import { countWords } from "./textMetrics";

describe("countWords", () => {
  it("returns 0 for empty or non-string input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(countWords(undefined)).toBe(0);
    expect(countWords(123)).toBe(0);
  });

  it("counts words separated by whitespace", () => {
    expect(countWords("one")).toBe(1);
    expect(countWords("one two")).toBe(2);
    expect(countWords(" one   two \n three\tfour ")).toBe(4);
  });
});

