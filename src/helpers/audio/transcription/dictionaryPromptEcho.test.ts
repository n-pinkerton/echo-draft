import { describe, expect, it } from "vitest";

import {
  areTranscriptionsEquivalent,
  classifyDictionaryPromptEcho,
  extractTermsFromCommaOrBullets,
  isLikelyDictionaryPromptEcho,
  shouldGuardDictionaryPromptEcho,
} from "./dictionaryPromptEcho.js";

describe("dictionaryPromptEcho", () => {
  const dictionary = [
    "Alpha",
    "Beta",
    "Gamma",
    "Delta",
    "Epsilon",
    "Zeta",
    "Eta",
    "Theta",
    "Iota",
    "Kappa",
  ];

  describe("shouldGuardDictionaryPromptEcho", () => {
    it("returns false when dictionary is too small", () => {
      expect(shouldGuardDictionaryPromptEcho(["one", "two", "three"])).toBe(false);
      expect(shouldGuardDictionaryPromptEcho(dictionary.slice(0, 9))).toBe(false);
    });

    it("returns true when dictionary is large enough", () => {
      expect(shouldGuardDictionaryPromptEcho(dictionary)).toBe(true);
    });
  });

  describe("extractTermsFromCommaOrBullets", () => {
    it("extracts comma-separated terms", () => {
      expect(extractTermsFromCommaOrBullets("Alpha, Beta, Gamma")).toEqual([
        "Alpha",
        "Beta",
        "Gamma",
      ]);
      expect(extractTermsFromCommaOrBullets("東京、مرحبا؟")).toEqual(["東京", "مرحبا؟"]);
    });

    it("extracts bullet terms when there are 3+ bullet lines", () => {
      const text = ["- Alpha", "- Beta", "- Gamma", "- Delta"].join("\n");
      expect(extractTermsFromCommaOrBullets(text)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    });
  });

  describe("isLikelyDictionaryPromptEcho", () => {
    it.each([
      [["Alpha"], "Alpha."],
      [["Alpha", "Beta"], "Alpha, Beta"],
      [dictionary.slice(0, 9), dictionary.slice(0, 9).join(", ")],
      [["東京"], "東京。"],
      [["東京"], "「東京。」"],
      [["東京"], "『東京。』"],
      [["مرحبا"], "مرحبا؟"],
    ])("rejects exact normalized echoes for short dictionaries", (entries, transcript) => {
      expect(isLikelyDictionaryPromptEcho(transcript, entries)).toBe(true);
      expect(classifyDictionaryPromptEcho(transcript, entries)).toBe("exact-short");
    });

    it("returns true when transcript matches dictionary closely", () => {
      expect(isLikelyDictionaryPromptEcho(dictionary.join(", "), dictionary)).toBe(true);
    });

    it("returns false when transcript only partially matches dictionary", () => {
      expect(isLikelyDictionaryPromptEcho(dictionary.slice(0, 9).join(", "), dictionary)).toBe(
        false
      );
    });

    it.each([
      ["Please ask Alpha to review the draft.", ["Alpha"]],
      ["Alpha and Beta should both attend tomorrow.", ["Alpha", "Beta"]],
      ["The Alpha release includes Beta but excludes Gamma.", ["Alpha", "Beta", "Gamma"]],
    ])("keeps legitimate sentences containing dictionary terms", (transcript, entries) => {
      expect(isLikelyDictionaryPromptEcho(transcript, entries)).toBe(false);
    });
  });

  describe("confirmation comparison", () => {
    it("ignores case and presentational Unicode punctuation", () => {
      expect(areTranscriptionsEquivalent("東京、مرحبا؟", "東京 مرحبا")).toBe(true);
      expect(areTranscriptionsEquivalent("Alpha, Beta.", "alpha beta")).toBe(true);
      expect(areTranscriptionsEquivalent("C#.", "c#")).toBe(true);
    });

    it.each([
      ["C++", "C#"],
      ["C++", "C"],
      ["C#", "C"],
      ["Node.js", "Node js"],
      ["100%", "100"],
    ])("preserves meaningful symbols in technical terms", (left, right) => {
      expect(areTranscriptionsEquivalent(left, right)).toBe(false);
    });

    it("rejects empty or materially different confirmation text", () => {
      expect(areTranscriptionsEquivalent("Alpha", "")).toBe(false);
      expect(areTranscriptionsEquivalent("Alpha", "Beta")).toBe(false);
    });

    it("does not collapse a symbol-bearing dictionary entry into another term", () => {
      expect(isLikelyDictionaryPromptEcho("C.", ["C#"])).toBe(false);
      expect(isLikelyDictionaryPromptEcho("C#.", ["C#"])).toBe(true);
    });
  });
});

