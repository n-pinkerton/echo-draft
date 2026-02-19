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

const encoder = new TextEncoder();

const makeResponseFromChunks = (chunks: string[]) => {
  let index = 0;
  return {
    body: {
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) {
            return { value: undefined, done: true };
          }
          const value = encoder.encode(chunks[index++]);
          return { value, done: false };
        },
      }),
    },
  };
};

describe("AudioManager", () => {
  const originalPermissions = (navigator as any).permissions;
  const originalMediaDevices = (navigator as any).mediaDevices;

  beforeEach(() => {
    localStorage.clear();
    // Provide a minimal electronAPI for modules that optionally query it.
    // Individual tests can override as needed.
    (window as any).electronAPI = {};
  });

  afterEach(() => {
    Object.defineProperty(navigator, "permissions", {
      value: originalPermissions,
      configurable: true,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("readTranscriptionStream handles JSON split across chunks", async () => {
    const manager = new AudioManager();

    const sse =
      'data: {"type":"transcript.text.delta","delta":"Hello"}\n\n' +
      'data: {"type":"transcript.text.delta","delta":" world"}\n\n' +
      "data: [DONE]\n\n";

    // Split in the middle of JSON to simulate chunk boundaries (no newline yet).
    const chunks = [
      'data: {"type":"transcript.text.delta","delta":"He',
      'llo"}\n\n',
      'data: {"type":"transcript.text.delta","delta":" wor',
      'ld"}\n\n',
      "data: [DONE]\n\n",
    ];

    expect(chunks.join("")).toBe(sse);

    const response = makeResponseFromChunks(chunks);
    const text = await manager.readTranscriptionStream(response as any);
    expect(text).toBe("Hello world");

    manager.cleanup();
  });

  it("readTranscriptionStream prefers collected deltas when done text is shorter", async () => {
    const manager = new AudioManager();

    const chunks = [
      'data: {"type":"transcript.text.delta","delta":"Hello world"}\n\n',
      'data: {"type":"transcript.text.done","text":"Hello"}\n\n',
      "data: [DONE]\n\n",
    ];

    const response = makeResponseFromChunks(chunks);
    const text = await manager.readTranscriptionStream(response as any);
    expect(text).toBe("Hello world");

    manager.cleanup();
  });

  it("processAudio enriches timings with recording diagnostics", async () => {
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

  it("saveDebugAudioCaptureIfEnabled calls ipc when debug is enabled", async () => {
    const manager = new AudioManager();

    const getDebugState = vi.fn(async () => ({ enabled: true, logPath: null, logLevel: "debug" }));
    const debugSaveAudio = vi.fn(async () => ({
      success: true,
      filePath: "/tmp/openwhispr-audio.webm",
      bytes: 4,
      kept: 1,
      deleted: 0,
    }));

    (window as any).electronAPI = { getDebugState, debugSaveAudio };

    const fakeBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
    };
    await manager.saveDebugAudioCaptureIfEnabled(fakeBlob as any, {
      sessionId: "test-session",
      jobId: 123,
      outputMode: "clipboard",
      durationSeconds: 1.23,
      stopReason: "manual",
      stopSource: "manual",
    });

    expect(getDebugState).toHaveBeenCalledTimes(1);
    expect(debugSaveAudio).toHaveBeenCalledTimes(1);

    expect(debugSaveAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "audio/webm",
        sessionId: "test-session",
        jobId: 123,
        outputMode: "clipboard",
        audioBuffer: expect.any(ArrayBuffer),
      })
    );

    manager.cleanup();
  });

  it("saveDebugAudioCaptureIfEnabled is a no-op when debug is disabled", async () => {
    const manager = new AudioManager();

    const getDebugState = vi.fn(async () => ({ enabled: false, logPath: null, logLevel: "info" }));
    const debugSaveAudio = vi.fn(async () => ({ success: true }));

    (window as any).electronAPI = { getDebugState, debugSaveAudio };

    const fakeBlob = {
      type: "audio/webm",
      arrayBuffer: vi.fn(async () => new Uint8Array([1]).buffer),
    };
    await manager.saveDebugAudioCaptureIfEnabled(fakeBlob as any, { sessionId: "test-session" });

    expect(getDebugState).toHaveBeenCalledTimes(1);
    expect(debugSaveAudio).not.toHaveBeenCalled();

    manager.cleanup();
  });

  it("warmupMicrophoneDriver skips when permission is prompt", async () => {
    const manager = new AudioManager();
    localStorage.setItem("preferBuiltInMic", "false");

    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    Object.defineProperty(navigator, "permissions", {
      value: { query: vi.fn(async () => ({ state: "prompt" })) },
      configurable: true,
    });

    const result = await manager.warmupMicrophoneDriver();
    expect(result).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();

    manager.cleanup();
  });

  it("warmupMicrophoneDriver skips when permission state is unknown and not previously granted", async () => {
    const manager = new AudioManager();
    localStorage.setItem("preferBuiltInMic", "false");

    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    Object.defineProperty(navigator, "permissions", {
      value: undefined,
      configurable: true,
    });

    const result = await manager.warmupMicrophoneDriver();
    expect(result).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();

    manager.cleanup();
  });

  it("warmupMicrophoneDriver pre-warms when permission is granted", async () => {
    const manager = new AudioManager();
    localStorage.setItem("preferBuiltInMic", "false");

    const trackStop = vi.fn();
    const fakeStream = { getTracks: () => [{ stop: trackStop }] };
    const getUserMedia = vi.fn(async () => fakeStream);

    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    Object.defineProperty(navigator, "permissions", {
      value: { query: vi.fn(async () => ({ state: "granted" })) },
      configurable: true,
    });

    expect(localStorage.getItem("micPermissionGranted")).toBe(null);

    const result = await manager.warmupMicrophoneDriver();
    expect(result).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalled();
    expect(localStorage.getItem("micPermissionGranted")).toBe("true");

    // Subsequent calls should be no-ops.
    const result2 = await manager.warmupMicrophoneDriver();
    expect(result2).toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    manager.cleanup();
  });

  it("shouldApplyReasoningCleanup respects per-job cleanupEnabled override", async () => {
    const manager = new AudioManager();

    localStorage.setItem("reasoningModel", "test-model");

    // Global enabled, override false => skip
    localStorage.setItem("useReasoningModel", "true");
    (manager as any).activeProcessingContext = { cleanupEnabled: false };
    expect(manager.shouldApplyReasoningCleanup()).toBe(false);

    // Global disabled, override true => run (reasoningModel is set)
    localStorage.setItem("useReasoningModel", "false");
    (manager as any).activeProcessingContext = { cleanupEnabled: true };
    expect(manager.shouldApplyReasoningCleanup()).toBe(true);

    manager.cleanup();
  });

  it("isReasoningAvailable respects per-job cleanupEnabled override", async () => {
    const manager = new AudioManager();

    // Global disabled, override true => availability check proceeds
    localStorage.setItem("useReasoningModel", "false");
    (manager as any).activeProcessingContext = { cleanupEnabled: true };
    await expect(manager.isReasoningAvailable()).resolves.toBe(true);

    // Global enabled, override false => skip entirely
    localStorage.setItem("useReasoningModel", "true");
    (manager as any).activeProcessingContext = { cleanupEnabled: false };
    await expect(manager.isReasoningAvailable()).resolves.toBe(false);

    manager.cleanup();
  });

  it("stopStreamingRecording forwards worklet flush audio before terminating", async () => {
    vi.useFakeTimers();

    (window as any).electronAPI = {
      assemblyAiStreamingSend: vi.fn(),
      assemblyAiStreamingForceEndpoint: vi.fn(),
      assemblyAiStreamingStop: vi.fn(async () => ({ success: true, text: "" })),
    };

    // Make sure auto re-warm is skipped in this unit test.
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
    // Simulate active streaming forwarding state as if startStreamingRecording ran.
    (manager as any).streamingAudioForwarding = true;

    const port = { onmessage: null as null | ((event: any) => void), postMessage: vi.fn() };
    manager.streamingProcessor = { port, disconnect: vi.fn() } as any;
    manager.streamingSource = { disconnect: vi.fn() } as any;
    manager.streamingStream = { getTracks: () => [{ stop: vi.fn() }] } as any;
    manager.streamingFinalText = "hello";

    // Attach a handler equivalent to the one installed during startStreamingRecording.
    port.onmessage = (event: any) => manager.streamingWorklet.handleMessage(event);

    const stopPromise = manager.stopStreamingRecording();

    // Simulate the worklet flushing a final buffer after stop was initiated.
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

  it("stopStreamingRecording preserves rawText when reasoning modifies streaming text", async () => {
    vi.useFakeTimers();

    const processTextMock = ReasoningService.processText as unknown as ReturnType<typeof vi.fn>;
    processTextMock.mockResolvedValueOnce("CLEANED");

    (window as any).electronAPI = {
      assemblyAiStreamingSend: vi.fn(),
      assemblyAiStreamingForceEndpoint: vi.fn(),
      assemblyAiStreamingStop: vi.fn(async () => ({ success: true, text: "" })),
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

  it("stopStreamingRecording prefers termination text when it is longer than live transcript", async () => {
    vi.useFakeTimers();

    (window as any).electronAPI = {
      assemblyAiStreamingSend: vi.fn(),
      assemblyAiStreamingForceEndpoint: vi.fn(),
      assemblyAiStreamingStop: vi.fn(async () => ({ success: true, text: "hello world" })),
    };

    // Make sure auto re-warm is skipped in this unit test.
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
});
