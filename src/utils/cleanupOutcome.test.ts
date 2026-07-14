import { describe, expect, it } from "vitest";

import { cleanupAppliedPreferredSpelling } from "./cleanupOutcome";

describe("cleanupAppliedPreferredSpelling", () => {
  it("accepts the current explicit flag", () => {
    expect(cleanupAppliedPreferredSpelling({ preferredSpellingApplied: true })).toBe(true);
  });

  it("accepts the legacy correction metric", () => {
    expect(
      cleanupAppliedPreferredSpelling({
        metrics: { preferredSpellingCorrectionCount: 1 },
      })
    ).toBe(true);
  });

  it("lets an explicit current false flag override attempted-candidate metrics", () => {
    expect(
      cleanupAppliedPreferredSpelling({
        preferredSpellingApplied: false,
        metrics: { preferredSpellingCorrectionCount: 1 },
      })
    ).toBe(false);
  });

  it("rejects absent, zero, and malformed evidence", () => {
    expect(cleanupAppliedPreferredSpelling(null)).toBe(false);
    expect(
      cleanupAppliedPreferredSpelling({ metrics: { preferredSpellingCorrectionCount: 0 } })
    ).toBe(false);
    expect(
      cleanupAppliedPreferredSpelling({ metrics: { preferredSpellingCorrectionCount: "1" } })
    ).toBe(false);
  });
});
