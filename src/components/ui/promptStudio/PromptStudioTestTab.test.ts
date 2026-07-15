import { describe, expect, it } from "vitest";

import { getCleanupResultNote } from "./cleanupResultNote";

describe("getCleanupResultNote", () => {
  it("identifies a successful Sol safety retry", () => {
    expect(
      getCleanupResultNote({
        status: "applied",
        retryCount: 1,
        appliedModel: "gpt-5.6-sol",
      })
    ).toContain("strict OpenAI GPT-5.6 Sol safety retry");
    expect(
      getCleanupResultNote({
        status: "applied",
        retryCount: 1,
        appliedModel: "gpt-5.6-sol",
      })
    ).toContain("every input word");
  });

  it("distinguishes preservation rejection from configuration and provider failures", () => {
    expect(
      getCleanupResultNote({ status: "fallback", fallbackReason: "fidelity_rejected" })
    ).toContain("Cleanup failed preservation checks");
    expect(
      getCleanupResultNote({
        status: "fallback",
        fallbackReason: "fidelity_rejected",
        retryCount: 1,
      })
    ).toContain("Both cleanup attempts failed preservation checks");
    expect(
      getCleanupResultNote({ status: "fallback", fallbackReason: "not_configured" })
    ).toContain("not configured");
    expect(getCleanupResultNote({ status: "fallback", fallbackReason: "unavailable" })).toContain(
      "unavailable"
    );
    expect(
      getCleanupResultNote({ status: "fallback", fallbackReason: "provider_error" })
    ).toContain("request failed");
  });

  it("describes a dictionary-only fallback without claiming the original was unchanged", () => {
    const note = getCleanupResultNote({
      status: "fallback",
      fallbackReason: "provider_error",
      preferredSpellingApplied: true,
    });

    expect(note).toContain("recognizer wording was kept");
    expect(note).toContain("verified dictionary spelling correction");
    expect(note).not.toContain("original text was kept");
  });

  it("describes recovered retry drift without claiming the retry was accepted", () => {
    const note = getCleanupResultNote({
      status: "unchanged",
      retryCount: 1,
      retryDriftRecovered: true,
      appliedModel: null,
      metrics: { retryDriftRecovered: true },
    });

    expect(note).toContain("changed one word and was discarded");
    expect(note).toContain("trusted source wording was kept");
    expect(note).not.toContain("accepted");
  });
});
