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

import ReasoningService from "../../services/ReasoningService";
import AudioManager from "../audioManager.js";

describe("AudioManager.stopStreamingRecording", () => {
  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("forwards worklet flush audio before terminating", async () => {
    vi.useFakeTimers();

    (window as any).electronAPI = {
      assemblyAiStreamingSend: vi.fn(),
      assemblyAiStreamingForceEndpoint: vi.fn(),
      assemblyAiStreamingStop: vi.fn(async () => ({
        success: true,
        text: "",
        terminationConfirmed: true,
      })),
    };

    localStorage.setItem("useLocalWhisper", "true");

    const manager = new AudioManager();
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError: vi.fn(),
      onTranscriptionComplete: vi.fn(),
      onPartialTranscript: vi.fn(),
      onProgress: vi.fn(),
    });

    manager.isStreaming = true;
    manager.isRecording = true;
    (manager as any).streamingAudioForwarding = true;

    const port = { onmessage: null as null | ((event: any) => void), postMessage: vi.fn() };
    manager.streamingProcessor = { port, disconnect: vi.fn() } as any;
    manager.streamingSource = { disconnect: vi.fn() } as any;
    manager.streamingStream = { getTracks: () => [{ stop: vi.fn() }] } as any;
    manager.streamingFinalText = "hello";

    port.onmessage = (event: any) => manager.streamingWorklet.handleMessage(event);

    const stopPromise = manager.stopStreamingRecording();

    const flushBuffer = new ArrayBuffer(8);
    setTimeout(() => port.onmessage?.({ data: flushBuffer }), 200);
    setTimeout(
      () => port.onmessage?.({ data: (manager as any).STREAMING_WORKLET_FLUSH_DONE_MESSAGE }),
      220
    );

    await vi.advanceTimersByTimeAsync(200);
    expect((window as any).electronAPI.assemblyAiStreamingSend).toHaveBeenCalledWith(flushBuffer);

    await vi.advanceTimersByTimeAsync(1000);
    await stopPromise;

    manager.cleanup();
  });

  it("shares concurrent stop requests so finalization and delivery happen once", async () => {
    vi.useFakeTimers();

    const assemblyAiStreamingStop = vi.fn(async () => ({
      success: true,
      text: "one complete dictation",
      terminationConfirmed: true,
    }));
    (window as any).electronAPI = {
      assemblyAiStreamingForceEndpoint: vi.fn(),
      assemblyAiStreamingStop,
    };
    localStorage.setItem("useLocalWhisper", "true");

    const manager = new AudioManager();
    const onProgress = vi.fn();
    const onTranscriptionComplete = vi.fn();
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError: vi.fn(),
      onTranscriptionComplete,
      onPartialTranscript: vi.fn(),
      onProgress,
    });
    manager.isStreaming = true;
    manager.isRecording = true;
    manager.streamingFinalText = "one complete dictation";

    const firstStop = manager.stopStreamingRecording();
    const repeatedStop = manager.stopStreamingRecording();
    await vi.runAllTimersAsync();

    await expect(Promise.all([firstStop, repeatedStop])).resolves.toEqual([true, true]);
    expect(assemblyAiStreamingStop).toHaveBeenCalledTimes(1);
    expect(onTranscriptionComplete).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "transcribing", recordingClosed: true })
    );
    expect(onProgress.mock.calls.filter(([event]) => event?.recordingClosed === true)).toHaveLength(
      1
    );

    manager.cleanup();
  });

  it("preserves rawText when reasoning modifies streaming text", async () => {
    vi.useFakeTimers();

    const processTextMock = ReasoningService.processText as unknown as ReturnType<typeof vi.fn>;
    processTextMock.mockResolvedValueOnce("CLEANED");

    (window as any).electronAPI = {
      assemblyAiStreamingSend: vi.fn(),
      assemblyAiStreamingForceEndpoint: vi.fn(),
      assemblyAiStreamingStop: vi.fn(async () => ({
        success: true,
        text: "",
        terminationConfirmed: true,
      })),
    };

    localStorage.setItem("useLocalWhisper", "true");
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("cloudReasoningMode", "byok");
    localStorage.setItem("reasoningModel", "test-model");

    const manager = new AudioManager();
    const onTranscriptionComplete = vi.fn();
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError: vi.fn(),
      onTranscriptionComplete,
      onPartialTranscript: vi.fn(),
      onProgress: vi.fn(),
    });

    manager.isStreaming = true;
    manager.isRecording = true;
    (manager as any).streamingAudioForwarding = true;
    manager.streamingFinalText = "RAW";

    const port = { onmessage: null as null | ((event: any) => void), postMessage: vi.fn() };
    manager.streamingProcessor = { port, disconnect: vi.fn() } as any;
    manager.streamingSource = { disconnect: vi.fn() } as any;
    manager.streamingStream = { getTracks: () => [{ stop: vi.fn() }] } as any;

    port.onmessage = (event: any) => manager.streamingWorklet.handleMessage(event);
    setTimeout(
      () => port.onmessage?.({ data: (manager as any).STREAMING_WORKLET_FLUSH_DONE_MESSAGE }),
      0
    );

    const stopPromise = manager.stopStreamingRecording();
    await vi.runAllTimersAsync();
    await stopPromise;

    expect(onTranscriptionComplete).toHaveBeenCalled();
    const payload = onTranscriptionComplete.mock.calls[0][0];
    expect(payload.text).toBe("CLEANED");
    expect(payload.rawText).toBe("RAW");

    manager.cleanup();
  });

  it("prefers termination text when it is longer than live transcript", async () => {
    vi.useFakeTimers();

    (window as any).electronAPI = {
      assemblyAiStreamingSend: vi.fn(),
      assemblyAiStreamingForceEndpoint: vi.fn(),
      assemblyAiStreamingStop: vi.fn(async () => ({
        success: true,
        text: "hello world",
        terminationConfirmed: true,
      })),
    };

    localStorage.setItem("useLocalWhisper", "true");
    localStorage.setItem("useReasoningModel", "false");

    const manager = new AudioManager();
    const onTranscriptionComplete = vi.fn();
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError: vi.fn(),
      onTranscriptionComplete,
      onPartialTranscript: vi.fn(),
      onProgress: vi.fn(),
    });

    manager.isStreaming = true;
    manager.isRecording = true;
    (manager as any).streamingAudioForwarding = true;
    manager.streamingFinalText = "hello";

    const port = { onmessage: null as null | ((event: any) => void), postMessage: vi.fn() };
    manager.streamingProcessor = { port, disconnect: vi.fn() } as any;
    manager.streamingSource = { disconnect: vi.fn() } as any;
    manager.streamingStream = { getTracks: () => [{ stop: vi.fn() }] } as any;

    port.onmessage = (event: any) => manager.streamingWorklet.handleMessage(event);
    setTimeout(
      () => port.onmessage?.({ data: (manager as any).STREAMING_WORKLET_FLUSH_DONE_MESSAGE }),
      0
    );

    const stopPromise = manager.stopStreamingRecording();
    await vi.runAllTimersAsync();
    await stopPromise;

    expect(onTranscriptionComplete).toHaveBeenCalled();
    const payload = onTranscriptionComplete.mock.calls[0][0];
    expect(payload.text).toBe("hello world");
    expect(payload.rawText).toBe("hello world");

    manager.cleanup();
  });

  it.each([
    ["a failed termination", { success: false, error: "socket closed" }],
    ["a timed-out termination", { success: true, text: "partial text", terminationTimedOut: true }],
    ["a success response without explicit confirmation", { success: true, text: "partial text" }],
  ])("does not deliver partial text after %s", async (_label, stopResult) => {
    vi.useFakeTimers();

    (window as any).electronAPI = {
      assemblyAiStreamingForceEndpoint: vi.fn(),
      assemblyAiStreamingStop: vi.fn(async () => stopResult),
    };
    localStorage.setItem("useLocalWhisper", "true");

    const manager = new AudioManager();
    const onError = vi.fn();
    const onTranscriptionComplete = vi.fn();
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError,
      onTranscriptionComplete,
      onPartialTranscript: vi.fn(),
      onProgress: vi.fn(),
    });
    manager.isStreaming = true;
    manager.isRecording = true;
    manager.streamingFinalText = "unconfirmed final text";
    manager.streamingPartialText = "unconfirmed partial text";

    const stopPromise = manager.stopStreamingRecording();
    await vi.runAllTimersAsync();

    await expect(stopPromise).resolves.toBe(false);
    expect(onTranscriptionComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Transcription incomplete",
        description: expect.stringContaining("no partial text was inserted"),
      })
    );

    manager.cleanup();
  });
});
