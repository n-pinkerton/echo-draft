import { describe, expect, it, vi } from "vitest";
import { waitForNonStreamingStopFlush } from "./nonStreamingStopFlush";

describe("waitForNonStreamingStopFlush", () => {
  it("measures flush delay and chunk counts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));

    const manager = { audioChunks: [new Blob(["a"]), new Blob(["b"])] } as any;
    const stopContext = { requestedAt: Date.now() - 100 };

    const promise = waitForNonStreamingStopFlush(manager, stopContext);
    await vi.advanceTimersByTimeAsync(60);

    const result = await promise;

    expect(result).toMatchObject({
      stopLatencyToFlushStartMs: 100,
      stopFlushMs: 60,
      chunksAtStopStart: 2,
      chunksAfterStopWait: 2,
    });

    vi.useRealTimers();
  });
});

