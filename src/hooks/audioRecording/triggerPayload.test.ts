import { describe, expect, it } from "vitest";

import { normalizeTriggerPayload } from "./triggerPayload";

describe("normalizeTriggerPayload", () => {
  it("normalizes outputMode and preserves provided fields", () => {
    const result = normalizeTriggerPayload(
      {
        outputMode: "clipboard",
        sessionId: "s-1",
        triggeredAt: 100,
        startedAt: 200,
        releasedAt: 300,
        insertionTarget: { hwnd: 123 },
        stopReason: " manual ",
        stopSource: " released ",
      },
      { now: () => 999, createSessionId: () => "s-x" }
    );

    expect(result).toEqual({
      outputMode: "clipboard",
      sessionId: "s-1",
      triggeredAt: 100,
      startedAt: 200,
      releasedAt: 300,
      insertionTarget: { hwnd: 123 },
      stopReason: "manual",
      stopSource: "released",
    });
  });

  it("fills defaults when fields are missing", () => {
    const result = normalizeTriggerPayload(
      {},
      {
        now: () => 1234,
        createSessionId: () => "s-generated",
      }
    );

    expect(result.outputMode).toBe("insert");
    expect(result.sessionId).toBe("s-generated");
    expect(result.triggeredAt).toBe(1234);
    expect(result.startedAt).toBeNull();
    expect(result.releasedAt).toBeNull();
    expect(result.insertionTarget).toBeNull();
    expect(result.stopReason).toBeNull();
    expect(result.stopSource).toBeNull();
  });
});

