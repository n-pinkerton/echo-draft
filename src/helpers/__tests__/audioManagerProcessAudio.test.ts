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

  it("aborts an active provider request and never delivers its late result", async () => {
    const manager = new AudioManager();
    localStorage.setItem("isSignedIn", "false");
    (manager as any).transcriptionPipeline.audioLevelAnalyzer = vi.fn(async () => ({
      available: false,
      reason: "test",
    }));

    let observedSignal: AbortSignal | null = null;
    const transcribeSpy = vi
      .spyOn((manager as any).openAiTranscriber, "processWithOpenAIAPI")
      .mockImplementation(async (_blob: Blob, _metadata: any, options: any) => {
        observedSignal = options.signal;
        return await new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => {
              const error: any = new Error("Transcription cancelled");
              error.code = "TRANSCRIPTION_CANCELLED";
              error.cancelled = true;
              reject(error);
            },
            { once: true }
          );
        });
      });

    const onTranscriptionComplete = vi.fn();
    const onError = vi.fn();
    const onProgress = vi.fn();
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError,
      onTranscriptionComplete,
      onPartialTranscript: vi.fn(),
      onProgress,
    });
    (manager as any).isProcessing = true;
    (manager as any).activeProcessingContext = { sessionId: "cancel-me", jobId: 9 };

    const pending = manager.processAudio(new Blob(["audio"], { type: "audio/webm" }));
    await vi.waitFor(() => expect(transcribeSpy).toHaveBeenCalledOnce());

    expect(manager.cancelProcessing()).toBe(true);
    await pending;

    expect(observedSignal?.aborted).toBe(true);
    expect(onTranscriptionComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "cancelled", message: "Processing cancelled" })
    );
    manager.cleanup();
  });

  it("cancels only the active queue job and preserves later jobs in FIFO order", async () => {
    const manager = new AudioManager();
    const processed: string[] = [];
    let resolveActive!: () => void;
    const activeCancelled = new Promise<void>((resolve) => {
      resolveActive = resolve;
    });

    vi.spyOn(manager, "processAudio").mockImplementation(async (_blob, _metadata, context: any) => {
      processed.push(`start:${context.sessionId}`);
      if (context.sessionId === "first") {
        const controller = new AbortController();
        (manager as any).activeProcessingAbortController = controller;
        controller.signal.addEventListener("abort", resolveActive, { once: true });
        await activeCancelled;
        processed.push("cancelled:first");
        return;
      }
      processed.push(`commit:${context.sessionId}`);
    });

    manager.enqueueProcessingJob(new Blob(["one"]), {}, { sessionId: "first", jobId: 1 });
    manager.enqueueProcessingJob(new Blob(["two"]), {}, { sessionId: "second", jobId: 2 });
    manager.enqueueProcessingJob(new Blob(["three"]), {}, { sessionId: "third", jobId: 3 });
    await vi.waitFor(() => expect(processed).toEqual(["start:first"]));

    expect(manager.cancelProcessing()).toBe(true);

    await vi.waitFor(() =>
      expect(processed).toEqual([
        "start:first",
        "cancelled:first",
        "start:second",
        "commit:second",
        "start:third",
        "commit:third",
      ])
    );
    expect(manager.getState().queuedProcessingJobs).toBe(0);
    manager.cleanup();
  });
});
