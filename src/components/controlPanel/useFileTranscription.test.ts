import { describe, expect, it } from "vitest";

import { getFileTranscriptionCompletionToast } from "./useFileTranscription";

describe("getFileTranscriptionCompletionToast", () => {
  it("reports a one-pass fidelity fallback as a preservation decision", () => {
    expect(
      getFileTranscriptionCompletionToast({
        requested: true,
        status: "fallback",
        fallbackReason: "fidelity_rejected",
      })
    ).toMatchObject({
      title: "Transcribed · original preserved",
      description: expect.stringContaining("Cleanup failed preservation checks"),
    });
  });

  it("mentions both attempts only when a safety retry actually ran", () => {
    expect(
      getFileTranscriptionCompletionToast({
        requested: true,
        status: "fallback",
        fallbackReason: "fidelity_rejected",
        retryCount: 1,
      })
    ).toMatchObject({
      description: expect.stringContaining("Both cleanup attempts failed preservation checks"),
    });
  });

  it.each([
    ["not_configured", "cleanup needs setup", "not configured"],
    ["unavailable", "cleanup unavailable", "provider was unavailable"],
    ["provider_error", "cleanup failed", "cleanup request failed"],
  ])("explains the %s fallback separately", (fallbackReason, title, description) => {
    expect(
      getFileTranscriptionCompletionToast({
        requested: true,
        status: "fallback",
        fallbackReason,
      })
    ).toMatchObject({
      title: expect.stringContaining(title),
      description: expect.stringContaining(description),
    });
  });
});
