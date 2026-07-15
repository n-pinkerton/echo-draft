import { describe, expect, it } from "vitest";

import { sanitizeTranscriptionMetaForDiagnostics } from "./transcriptionDiagnostics";

describe("sanitizeTranscriptionMetaForDiagnostics", () => {
  it("omits provider-controlled errors, malformed IDs, and arbitrary response data", () => {
    const sentinel = "private-customer-transcript";
    const output = sanitizeTranscriptionMetaForDiagnostics({
      sessionId: "session-1",
      error: sentinel,
      delivery: {
        status: "failed",
        succeeded: false,
        reasonCode: "WINDOWS_CLIPBOARD_RESTORE_PENDING",
        error: sentinel,
      },
      cleanup: {
        status: "fallback",
        modelSource: "managed",
        preferredSpellingApplied: true,
        retryDriftEditType: "deletion",
        initialFidelityReasons: ["material-compression", sentinel],
        retryFidelityReasons: ["strict-lexical-sequence-change"],
      },
      responseKeys: [sentinel],
      usage: { arbitrary: sentinel },
      timings: {
        transcriptionRequestId: `${sentinel}\r\nInjected: yes`,
        transcriptionRequestIds: ["safe-request", sentinel.repeat(20)],
        transcriptionTransportAttempts: [
          { attempt: 1, requestId: sentinel, outcome: "success", response: sentinel },
        ],
      },
    });
    const serialized = JSON.stringify(output);

    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain("Injected");
    expect(serialized).not.toContain("responseKeys");
    expect(serialized).not.toContain("usage");
    expect(output).toMatchObject({
      sessionId: "session-1",
      delivery: {
        status: "failed",
        succeeded: false,
        reasonCode: "WINDOWS_CLIPBOARD_RESTORE_PENDING",
      },
      cleanup: {
        status: "fallback",
        modelSource: "managed",
        preferredSpellingApplied: true,
        retryDriftEditType: "deletion",
        initialFidelityReasons: ["material-compression"],
        retryFidelityReasons: ["strict-lexical-sequence-change"],
      },
      timings: { transcriptionRequestIds: [expect.stringMatching(/^req-[a-f0-9]{8}$/)] },
    });
  });

  it("drops malformed delivery reason codes and unknown cleanup provenance", () => {
    const output = sanitizeTranscriptionMetaForDiagnostics({
      delivery: {
        status: "failed",
        succeeded: false,
        reasonCode: "unsafe\r\nInjected: yes",
      },
      cleanup: {
        status: "fallback",
        modelSource: "guessed",
        retryDriftEditType: "rewritten",
        initialFidelityReasons: ["private-customer-transcript"],
        retryFidelityReasons: ["unsafe\r\nInjected: yes"],
      },
    });

    expect(output).toEqual({
      delivery: { status: "failed", succeeded: false },
      cleanup: { status: "fallback" },
    });
  });
});
