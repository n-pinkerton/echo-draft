import { describe, expect, it } from "vitest";

import { applyCorrectionRules, areCorrectionPhrasesEquivalent } from "./correctionRules.cjs";

describe("explicit correction rules", () => {
  it("applies enabled literal rules case-insensitively at word boundaries", () => {
    const result = applyCorrectionRules("Ask ACME, not acmeish, then acme.", [
      { id: 1, sourcePhrase: "acme", replacementText: "Acme Ltd", enabled: true },
    ]);

    expect(result.text).toBe("Ask Acme Ltd, not acmeish, then Acme Ltd.");
    expect(result.replacements).toHaveLength(2);
  });

  it("matches against the original input so replacements never cascade", () => {
    const result = applyCorrectionRules("alpha beta", [
      { id: 1, sourcePhrase: "alpha", replacementText: "beta", enabled: true },
      { id: 2, sourcePhrase: "beta", replacementText: "gamma", enabled: true },
    ]);

    expect(result.text).toBe("beta gamma");
  });

  it("prefers the longest rule at the same position and ignores disabled rules", () => {
    const result = applyCorrectionRules("new zealand and nz", [
      { id: 2, sourcePhrase: "new", replacementText: "Old", enabled: true },
      { id: 1, sourcePhrase: "new zealand", replacementText: "Aotearoa", enabled: true },
      { id: 3, sourcePhrase: "nz", replacementText: "New Zealand", enabled: false },
    ]);

    expect(result.text).toBe("Aotearoa and nz");
    expect(result.replacements.map((replacement) => replacement.ruleId)).toEqual([1]);
  });

  it("treats astral letters and combining marks as Unicode word characters", () => {
    const astralRule = [{ id: 1, sourcePhrase: "𐐀", replacementText: "Deseret", enabled: true }];
    expect(applyCorrectionRules("a𐐀b 𐐀.", astralRule).text).toBe("a𐐀b Deseret.");

    const decomposedLetter = "e\u0301";
    const combiningRule = [
      { id: 2, sourcePhrase: decomposedLetter, replacementText: "é", enabled: true },
    ];
    expect(
      applyCorrectionRules(`${decomposedLetter}clair ${decomposedLetter}.`, combiningRule).text
    ).toBe(`${decomposedLetter}clair é.`);
  });

  it("uses the matcher case semantics to identify equivalent source phrases", () => {
    expect(areCorrectionPhrasesEquivalent("Ärger", "ärger")).toBe(true);
    expect(areCorrectionPhrasesEquivalent("Māori", "maori")).toBe(false);
  });
});
