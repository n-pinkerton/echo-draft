import { describe, expect, it, vi } from "vitest";

import { emitError, emitProgress, emitStateChange } from "./audioManagerEvents";

describe("audioManagerEvents", () => {
  it("emitProgress attaches timestamp and active context for non-listening stages", () => {
    const onProgress = vi.fn();
    const manager: any = {
      onProgress,
      activeProcessingContext: { sessionId: "s1", jobId: 7, outputMode: "clipboard" },
    };

    emitProgress(manager, { stage: "transcribing", stageLabel: "Transcribing" });

    expect(onProgress).toHaveBeenCalledTimes(1);
    const payload = onProgress.mock.calls[0][0];
    expect(typeof payload.timestamp).toBe("number");
    expect(payload.context).toEqual(manager.activeProcessingContext);
    expect(payload.jobId).toBe(7);
  });

  it("emitStateChange and emitError swallow handler exceptions", () => {
    const manager: any = {
      onStateChange: vi.fn(() => {
        throw new Error("boom");
      }),
      onError: vi.fn(() => {
        throw new Error("boom2");
      }),
    };

    expect(() => emitStateChange(manager, { isRecording: false })).not.toThrow();
    expect(() => emitError(manager, { title: "x" }, new Error("root"))).not.toThrow();
  });
});

