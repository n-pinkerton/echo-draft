import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/neonAuth", () => ({
  withSessionRefresh: async (fn: any) => await fn(),
}));

vi.mock("../../services/ReasoningService", () => ({
  default: {
    processText: vi.fn(async (text: string) => text),
    isAvailable: vi.fn(async () => true),
  },
}));

import AudioManager from "../audioManager.js";

describe("AudioManager.processAudio", () => {
  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("enriches timings with recording diagnostics", async () => {
    const manager = new AudioManager();
    localStorage.setItem("isSignedIn", "false");

    const transcribeSpy = vi
      .spyOn((manager as any).openAiTranscriber, "processWithOpenAIAPI")
      .mockResolvedValue({
        success: true,
        text: "Hello",
        rawText: "Hello",
        source: "openai",
        timings: { transcriptionProcessingDurationMs: 5 },
      });

    const onTranscriptionComplete = vi.fn();
    manager.setCallbacks({
      onStateChange: null as any,
      onError: null as any,
      onTranscriptionComplete,
      onPartialTranscript: null as any,
      onProgress: null as any,
    });

    (manager as any).isProcessing = true;
    (manager as any).activeProcessingContext = {
      sessionId: "s1",
      outputMode: "clipboard",
      jobId: 7,
    };

    const audioBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" });

    await manager.processAudio(audioBlob, {
      durationSeconds: 1.23,
      stopReason: "released",
      stopSource: "hotkey",
      stopRequestedAt: 123,
      stopLatencyMs: 456,
      stopLatencyToFlushStartMs: 10,
      stopFlushMs: 60,
      chunksCount: 2,
      chunksBeforeStopWait: 1,
      chunksAfterStopWait: 2,
    });

    expect(transcribeSpy).toHaveBeenCalledTimes(1);
    expect(onTranscriptionComplete).toHaveBeenCalledTimes(1);

    const payload = onTranscriptionComplete.mock.calls[0][0];
    expect(payload.timings).toMatchObject({
      transcriptionProcessingDurationMs: 5,
      audioSizeBytes: 4,
      audioFormat: "audio/webm",
      stopReason: "released",
      stopSource: "hotkey",
      stopRequestedAt: 123,
      stopLatencyMs: 456,
      stopLatencyToFlushStartMs: 10,
      stopFlushMs: 60,
      chunksCount: 2,
      chunksBeforeStopWait: 1,
      chunksAfterStopWait: 2,
    });

    manager.cleanup();
  });
});

