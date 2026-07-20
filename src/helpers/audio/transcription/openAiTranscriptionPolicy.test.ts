import { describe, expect, it } from "vitest";
import {
  analyzeCandidate,
  applyCombinedTranscriptionTimings,
  choosePreferredResult,
  combineTranscriptionTimings,
  getAttemptAgreement,
  getRetryAfterMs,
  isHardReject,
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

  it.each([
    ["sparse output below the duration threshold", "yes please", 11.999, false, false],
    ["low-rate output at the duration threshold", "yes please", 12, false, true],
    ["output at exactly 0.2 words per second", "one two three", 15, false, false],
    ["output below 0.2 words per second", "one two", 12, false, true],
    ["corroborated output below 0.2 words per second", "one two", 12, true, false],
  ])("classifies %s", (_name, text, durationSeconds, corroboratedByRetry, expected) => {
    const analysis = analyzeCandidate(text, { durationSeconds });
    expect(isHardReject(analysis, { durationSeconds, corroboratedByRetry })).toBe(expected);
  });

  it("applies the suspiciously-short reason only below 0.6 words per second", () => {
    const atBoundary = analyzeCandidate("one two three four five six seven eight nine", {
      durationSeconds: 15,
    });
    const belowBoundary = analyzeCandidate("one two three four five six seven eight", {
      durationSeconds: 15,
    });

    expect(atBoundary.wordsPerSecond).toBe(0.6);
    expect(atBoundary.reasons).not.toContain("suspiciously-short-for-duration");
    expect(belowBoundary.wordsPerSecond).toBeLessThan(0.6);
    expect(belowBoundary.wordsPerSecond).toBeGreaterThanOrEqual(0.2);
    expect(belowBoundary.reasons).toContain("suspiciously-short-for-duration");
    expect(isHardReject(belowBoundary, { durationSeconds: 15 })).toBe(false);
  });

  it.each([
    ["both unknown-duration minimums", "go now", false],
    ["below the minimum word count", "spoken", true],
    ["below the minimum character count", "a bc", true],
  ])("handles prompt echo recovery at %s", (_name, text, expected) => {
    const analysis = analyzeCandidate(text, { promptEchoDetected: true });
    expect(isHardReject(analysis, { promptEchoDetected: true, durationSeconds: null })).toBe(
      expected
    );
  });

  it("requires corroboration for a strict-prefix extension", () => {
    const agreement = getAttemptAgreement(
      "Please send the revised budget to Sam Friday",
      "Please send the revised budget to Sam Friday and copy Alex before lunch"
    );

    expect(agreement).toMatchObject({
      agreed: false,
      strictPrefixExtension: true,
      requiresCorroboration: true,
    });
  });

  it("distinguishes corroborating agreement from material disagreement", () => {
    expect(
      getAttemptAgreement(
        "Please send the revised budget to Sam Friday",
        "Please send the revised budget to Sam Friday"
      )
    ).toMatchObject({ agreed: true, requiresCorroboration: false });
    expect(
      getAttemptAgreement(
        "Please send the revised budget to Sam Friday",
        "Garden tools need dry storage beside the bicycle"
      )
    ).toMatchObject({ agreed: false, requiresCorroboration: false });
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

  it("applies ordered attempt and transport evidence to the supplied timing object", () => {
    const timings = { existingMetric: 7 };
    const attempts = [
      {
        attemptLabel: "primary",
        attemptOutcome: "retry",
        timings: {
          transcriptionProcessingDurationMs: 10,
          transcriptionTransportAttempts: [{ requestId: "first", attempt: 1 }],
        },
      },
      {
        attemptLabel: "primary-noprompt",
        attemptOutcome: "success",
        timings: {
          transcriptionProcessingDurationMs: 20,
          transcriptionTransportAttempts: [{ requestId: "second", attempt: 1 }],
        },
      },
    ];

    expect(applyCombinedTranscriptionTimings(timings, attempts)).toBeUndefined();
    expect(timings).toMatchObject({
      existingMetric: 7,
      transcriptionAttemptCount: 2,
      transcriptionRequestIds: ["first", "second"],
      transcriptionAttempts: [
        { attempt: 1, label: "primary", outcome: "retry" },
        { attempt: 2, label: "primary-noprompt", outcome: "success" },
      ],
      transcriptionTransportAttempts: [
        { requestId: "first", transcriptionAttempt: 1, attemptLabel: "primary" },
        { requestId: "second", transcriptionAttempt: 2, attemptLabel: "primary-noprompt" },
      ],
    });
  });
});
