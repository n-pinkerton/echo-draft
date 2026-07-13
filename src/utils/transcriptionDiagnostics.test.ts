import { describe, expect, it } from "vitest";

import { sanitizeTranscriptionMetaForDiagnostics } from "./transcriptionDiagnostics";

describe("sanitizeTranscriptionMetaForDiagnostics", () => {
  it("omits provider-controlled errors, malformed IDs, and arbitrary response data", () => {
    const sentinel = "PRIVATE_TRANSCRIPT_SENTINEL";
    const output = sanitizeTranscriptionMetaForDiagnostics({
      sessionId: "session-1",
      error: sentinel,
      delivery: { status: "failed", succeeded: false, error: sentinel },
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
      delivery: { status: "failed", succeeded: false },
      timings: { transcriptionRequestIds: [expect.stringMatching(/^req-[a-f0-9]{8}$/)] },
    });
  });
});
