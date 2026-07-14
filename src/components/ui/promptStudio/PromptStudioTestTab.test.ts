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
});
