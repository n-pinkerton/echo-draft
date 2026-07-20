import { describe, expect, it } from "vitest";
import {
  analyzeCandidate,
  choosePreferredResult,
  combineTranscriptionTimings,
  getAttemptAgreement,
  getRetryAfterMs,
  isRetryableHttpStatus,
  normalizeProxyDurationMs,
} from "./openAiTranscriptionPolicy";

describe("OpenAI transcription policy", () => {
  it.each([
    ["empty", "", ["empty"], -1000],
    ["punctuation-only", "...", ["punctuation-only"], -299],
    ["normal", "keep this transcript", [], 3],
  ])("analyzes %s candidates", (_name, text, reasons, score) => {
    const analysis = analyzeCandidate(text);
    expect(analysis.reasons).toEqual(reasons);
    expect(analysis.score).toBe(score);
  });

  it("marks long assistant-style output as a retry candidate", () => {
    const text = [
      "Certainly, here is a response.",
      "It includes clarifications and recommendations.",
      Array.from({ length: 80 }, (_, index) => `word${index}`).join(" "),
    ].join(" ");
    const analysis = analyzeCandidate(text, { durationSeconds: 20 });
    expect(analysis.looksAssistantStyle).toBe(true);
    expect(analysis.reasons).toContain("assistant-style-output");
  });

  it.each([
    [200, 200, false],
    [408, 200, true],
    [429, 200, true],
    [500, 200, true],
    [404, 200, false],
  ])("classifies transport status %s", (status, _fallback, retryable) => {
    expect(isRetryableHttpStatus(status)).toBe(retryable);
  });

  it("normalizes bounded timing values and retry-after hints", () => {
    expect(normalizeProxyDurationMs("12.4")).toBe(12);
    expect(normalizeProxyDurationMs(-1)).toBeNull();
    expect(getRetryAfterMs({ headers: { get: () => "2" } }, 750)).toBe(2000);
    expect(getRetryAfterMs({ headers: { get: () => "invalid" } }, 750, 1_000)).toBe(750);
  });

  it("selects an agreed retry result only when it scores higher", () => {
    const primary = { rawText: "short transcript" };
    const retry = { rawText: "short transcript with additional detail" };
    const selection = choosePreferredResult(primary, retry);
    expect(selection.selectedName).toBe("retry");
    expect(getAttemptAgreement(primary.rawText, retry.rawText).requiresCorroboration).toBe(true);
  });

  it("returns disagreement without selecting a candidate when agreement is required", () => {
    const selection = choosePreferredResult(
      { rawText: "alpha transcript" },
      { rawText: "unrelated words" },
      { requireAgreement: true }
    );
    expect(selection).toMatchObject({ selected: null, selectedName: "disagreement" });
  });

  it("combines attempt and transport timing records in order", () => {
    expect(
      combineTranscriptionTimings([
        {
          attemptLabel: "primary",
          attemptOutcome: "retry",
          timings: {
            transcriptionProcessingDurationMs: 10,
            transcriptionTransportAttempts: [{ requestId: "a" }],
          },
        },
        {
          attemptLabel: "retry",
          timings: {
            transcriptionProcessingDurationMs: 20,
            transcriptionTransportAttempts: [{ requestId: "b" }],
            transcriptionTimeToHeadersMs: 3,
          },
        },
      ])
    ).toMatchObject({
      transcriptionProcessingDurationMs: 30,
      transcriptionAttemptCount: 2,
      transcriptionRetried: true,
      transcriptionRequestIds: ["a", "b"],
      transcriptionAttempts: [
        { attempt: 1, label: "primary", outcome: "retry" },
        { attempt: 2, label: "retry", outcome: "success" },
      ],
    });
  });
});
