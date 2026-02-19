import { describe, expect, it } from "vitest";

import {
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
    });

    it("extracts bullet terms when there are 3+ bullet lines", () => {
      const text = ["- Alpha", "- Beta", "- Gamma", "- Delta"].join("\n");
      expect(extractTermsFromCommaOrBullets(text)).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
    });
  });

  describe("isLikelyDictionaryPromptEcho", () => {
    it("returns false when guard is disabled", () => {
      expect(isLikelyDictionaryPromptEcho("Alpha, Beta, Gamma", ["Alpha", "Beta", "Gamma"])).toBe(
        false
      );
    });

    it("returns true when transcript matches dictionary closely", () => {
      expect(isLikelyDictionaryPromptEcho(dictionary.join(", "), dictionary)).toBe(true);
    });

    it("returns false when transcript only partially matches dictionary", () => {
      expect(isLikelyDictionaryPromptEcho(dictionary.slice(0, 9).join(", "), dictionary)).toBe(
        false
      );
    });
  });
});

