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

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

class RapidMediaRecorder {
  stream: any;
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: any) => void) | null = null;
  onstop: (() => any) | null = null;

  constructor(stream: any) {
    this.stream = stream;
  }

  start() {
    this.state = "recording";
  }

  requestData() {
    this.ondataavailable?.({
      data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }),
    });
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([], { type: this.mimeType }) });
    void this.onstop?.();
  }
}

describe("AudioManager.stopStreamingRecording", () => {
  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("cancels a never-settling startup through the public stop path", async () => {
    vi.useFakeTimers();
    const trackStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: trackStop }],
          getAudioTracks: () => [],
        })),
      },
      configurable: true,
    });
    const assemblyAiStreamingStart = vi.fn();
    const assemblyAiStreamingStop = vi.fn(async () => ({ success: false }));
    (window as any).electronAPI = { assemblyAiStreamingStart, assemblyAiStreamingStop };
    const manager = new AudioManager() as any;
    manager.getAudioConstraints = vi.fn(async () => ({ audio: true }));
    manager.withSessionRefresh = vi.fn(
      (_operation: any, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        })
    );

    const startup = manager.startStreamingRecording();
    await vi.waitFor(() => expect(manager.streamingStartInProgress).toBe(true));
    await expect(manager.stopStreamingRecording()).resolves.toBe(true);
    await expect(startup).resolves.toBe(false);

    expect(trackStop).toHaveBeenCalledOnce();
    expect(assemblyAiStreamingStart).not.toHaveBeenCalled();
    expect(assemblyAiStreamingStop).toHaveBeenCalledOnce();
    expect(manager.streamingStartInProgress).toBe(false);
    expect(manager.streamingStartAbortController).toBeNull();
    expect(manager.isRecording).toBe(false);
  });

  it("invalidates startup before a late auth refresh can connect", async () => {
    vi.useFakeTimers();
    let finishRefresh!: () => void;
    const trackStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: trackStop }],
          getAudioTracks: () => [],
        })),
      },
      configurable: true,
    });
    const assemblyAiStreamingStart = vi.fn(async () => ({ success: true }));
    const assemblyAiStreamingStop = vi.fn(async () => ({ success: false }));
    (window as any).electronAPI = { assemblyAiStreamingStart, assemblyAiStreamingStop };
    const manager = new AudioManager() as any;
    manager.getAudioConstraints = vi.fn(async () => ({ audio: true }));
    manager.withSessionRefresh = vi.fn(
      (operation: () => Promise<any>) =>
        new Promise((resolve) => {
          finishRefresh = () => resolve(operation());
        })
    );

    const startup = manager.startStreamingRecording();
    await vi.waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    await expect(manager.stopStreamingRecording()).resolves.toBe(true);
    await expect(startup).resolves.toBe(false);

    // Resolve the ignored refresh only after the main-process cancellation
    // retention window would have expired.
    await vi.advanceTimersByTimeAsync(31_000);
    finishRefresh();
    await Promise.resolve();
    await Promise.resolve();

    expect(trackStop).toHaveBeenCalledOnce();
    expect(assemblyAiStreamingStart).not.toHaveBeenCalled();
    expect(assemblyAiStreamingStop).toHaveBeenCalledOnce();
    expect(manager.isRecording).toBe(false);
    expect(manager.isStreaming).toBe(false);
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
    processTextMock.mockResolvedValueOnce(
      JSON.stringify({ title: "Friendly greeting", text: "Hello, world." })
    );

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
    manager.streamingFinalText = "hello world";

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
    expect(payload.text).toBe("Hello, world.");
    expect(payload.rawText).toBe("hello world");
    expect(payload.title).toBe("Friendly greeting");

    manager.cleanup();
  });

  it("records one managed cleanup attempt when streaming fidelity validation rejects it", async () => {
    vi.useFakeTimers();

    const cloudReason = vi.fn(async () => ({
      success: true,
      text: "Short summary.",
      model: "gpt-5.6-luna",
    }));
    (window as any).electronAPI = {
      assemblyAiStreamingSend: vi.fn(),
      assemblyAiStreamingForceEndpoint: vi.fn(),
      assemblyAiStreamingStop: vi.fn(async () => ({
        success: true,
        text: "",
        terminationConfirmed: true,
      })),
      cloudReason,
      cancelIpcRequest: vi.fn(async () => ({ success: true })),
    };

    localStorage.setItem("useLocalWhisper", "true");
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("cloudReasoningMode", "echodraft");

    const manager = new AudioManager();
    const fidelityError = Object.assign(new Error("changed too much"), {
      code: "CLEANUP_FIDELITY_REJECTED",
      assessment: { metrics: { wordRatio: 0.2 } },
    });
    (manager as any).reasoningCleanupService = {
      validateCleanupCandidate: vi.fn(() => {
        throw fidelityError;
      }),
    };
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
    manager.streamingFinalText = "Keep the Friday deadline and every budget caveat";

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

    expect(cloudReason).toHaveBeenCalledTimes(1);
    expect(onTranscriptionComplete).toHaveBeenCalledOnce();
    const payload = onTranscriptionComplete.mock.calls[0][0];
    expect(payload.text).toBe("Keep the Friday deadline and every budget caveat");
    expect(payload.cleanup).toMatchObject({
      status: "fallback",
      fallbackReason: "fidelity_rejected",
      model: "gpt-5.6-luna",
      appliedModel: null,
      retryCount: 0,
    });

    manager.cleanup();
  });

  it("cancels in-flight streaming cleanup and never delivers a late result", async () => {
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
    localStorage.setItem("useReasoningModel", "true");
    localStorage.setItem("cloudReasoningMode", "byok");
    localStorage.setItem("reasoningModel", "test-model");

    const manager = new AudioManager();
    const onTranscriptionComplete = vi.fn();
    const processTranscriptionWithOutcome = vi.fn(
      async (_text: string, _source: string, _override: unknown, runtime: any) =>
        await new Promise((_resolve, reject) => {
          runtime.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    (manager as any).reasoningCleanupService = { processTranscriptionWithOutcome };
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
    manager.streamingFinalText = "hello world";

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
    expect(processTranscriptionWithOutcome).toHaveBeenCalledOnce();
    expect(manager.cancelProcessing()).toBe(true);

    await expect(stopPromise).resolves.toBe(false);
    expect(onTranscriptionComplete).not.toHaveBeenCalled();
    expect((manager as any).activeProcessingAbortController).toBeNull();

    manager.cleanup();
  });

  it("awaits main-process teardown before rewarming when cancelled during worklet flush", async () => {
    vi.useFakeTimers();
    const teardown = deferred<any>();
    const assemblyAiStreamingStop = vi.fn(() => teardown.promise);
    (window as any).electronAPI = {
      assemblyAiStreamingForceEndpoint: vi.fn(),
      assemblyAiStreamingStop,
    };

    const manager = new AudioManager();
    const warmupStreamingConnection = vi.fn(async () => true);
    (manager as any).shouldUseStreaming = vi.fn(() => true);
    (manager as any).warmupStreamingConnection = warmupStreamingConnection;
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
    manager.streamingProcessor = {
      port: { postMessage: vi.fn() },
      disconnect: vi.fn(),
    } as any;
    manager.streamingSource = { disconnect: vi.fn() } as any;
    manager.streamingStream = { getTracks: () => [{ stop: vi.fn() }] } as any;

    const stopPromise = manager.stopStreamingRecording();
    expect(manager.cancelProcessing()).toBe(true);
    await vi.waitFor(() => expect(assemblyAiStreamingStop).toHaveBeenCalledOnce());
    expect(warmupStreamingConnection).not.toHaveBeenCalled();

    teardown.resolve({ success: false, terminationConfirmed: false });
    await expect(stopPromise).resolves.toBe(false);
    expect(assemblyAiStreamingStop).toHaveBeenCalledOnce();
    expect(warmupStreamingConnection).toHaveBeenCalledOnce();

    manager.cleanup();
  });

  it("shares and awaits an already pending main stop before cancellation settles", async () => {
    vi.useFakeTimers();
    const teardown = deferred<any>();
    const assemblyAiStreamingStop = vi.fn(() => teardown.promise);
    const onTranscriptionComplete = vi.fn();
    (window as any).electronAPI = {
      assemblyAiStreamingForceEndpoint: vi.fn(),
      assemblyAiStreamingStop,
    };

    const manager = new AudioManager();
    const warmupStreamingConnection = vi.fn(async () => true);
    (manager as any).shouldUseStreaming = vi.fn(() => true);
    (manager as any).warmupStreamingConnection = warmupStreamingConnection;
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError: vi.fn(),
      onTranscriptionComplete,
      onPartialTranscript: vi.fn(),
      onProgress: vi.fn(),
    });
    manager.isStreaming = true;
    manager.isRecording = true;
    manager.streamingFinalText = "must not be delivered";

    const stopPromise = manager.stopStreamingRecording();
    await vi.advanceTimersByTimeAsync(150);
    await vi.waitFor(() => expect(assemblyAiStreamingStop).toHaveBeenCalledOnce());

    expect(manager.cancelProcessing()).toBe(true);
    expect(warmupStreamingConnection).not.toHaveBeenCalled();
    teardown.resolve({ success: true, text: "late text", terminationConfirmed: true });

    await expect(stopPromise).resolves.toBe(false);
    expect(assemblyAiStreamingStop).toHaveBeenCalledOnce();
    expect(onTranscriptionComplete).not.toHaveBeenCalled();
    expect(warmupStreamingConnection).toHaveBeenCalledOnce();

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

  it("releases streaming capture ownership before a rapid non-streaming recording stops", async () => {
    vi.useFakeTimers();
    const originalMediaRecorder = (globalThis as any).MediaRecorder;
    const originalMediaDevices = (navigator as any).mediaDevices;

    const teardown = deferred<any>();
    const secondTrack = {
      label: "Second Mic",
      stop: vi.fn(),
      addEventListener: vi.fn(),
      getSettings: () => ({ deviceId: "second", sampleRate: 48_000, channelCount: 1 }),
    };
    const secondStream = {
      getTracks: () => [secondTrack],
      getAudioTracks: () => [secondTrack],
    };

    try {
      (globalThis as any).MediaRecorder = RapidMediaRecorder;
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: vi.fn(async () => secondStream) },
        configurable: true,
      });
      (window as any).electronAPI = {
        assemblyAiStreamingForceEndpoint: vi.fn(),
        assemblyAiStreamingStop: vi.fn(() => teardown.promise),
      };

      const manager = new AudioManager() as any;
      manager.getAudioConstraints = vi.fn(async () => ({ audio: true }));
      manager.enqueueProcessingJob = vi.fn(() => ({ jobsAhead: 1, position: 2 }));
      manager.setCallbacks({
        onStateChange: vi.fn(),
        onError: vi.fn(),
        onTranscriptionComplete: vi.fn(),
        onPartialTranscript: vi.fn(),
        onProgress: vi.fn(),
      });
      manager.isStreaming = true;
      manager.isRecording = true;
      manager.streamingFinalText = "";

      const firstFinalization = manager.stopStreamingRecording();
      expect(manager.getState()).toMatchObject({ isRecording: false, isStreaming: false });

      await expect(
        manager.startRecording({ sessionId: "second", jobId: 2, outputMode: "insert" })
      ).resolves.toBe(true);
      const secondStop = manager.stopRecordingAndWaitForClose({
        reason: "manual",
        source: "hotkey",
        sessionId: "second",
        outputMode: "insert",
      });

      await vi.advanceTimersByTimeAsync(400);
      await expect(secondStop).resolves.toBe(true);
      expect(manager.enqueueProcessingJob).toHaveBeenCalledOnce();
      expect(manager.mediaRecorder).toBeNull();

      teardown.resolve({ success: true, text: "", terminationConfirmed: true });
      await vi.runAllTimersAsync();
      await expect(firstFinalization).resolves.toBe(true);
      manager.cleanup();
    } finally {
      (globalThis as any).MediaRecorder = originalMediaRecorder;
      Object.defineProperty(navigator, "mediaDevices", {
        value: originalMediaDevices,
        configurable: true,
      });
    }
  });

  it("keeps cancelled streaming teardown as the owner until a second recording drains FIFO", async () => {
    vi.useFakeTimers();
    const originalMediaRecorder = (globalThis as any).MediaRecorder;
    const originalMediaDevices = (navigator as any).mediaDevices;
    const teardown = deferred<any>();
    const secondTrack = {
      label: "Second Mic",
      stop: vi.fn(),
      addEventListener: vi.fn(),
      getSettings: () => ({ deviceId: "second", sampleRate: 48_000, channelCount: 1 }),
    };
    const secondStream = {
      getTracks: () => [secondTrack],
      getAudioTracks: () => [secondTrack],
    };

    try {
      (globalThis as any).MediaRecorder = RapidMediaRecorder;
      Object.defineProperty(navigator, "mediaDevices", {
        value: { getUserMedia: vi.fn(async () => secondStream) },
        configurable: true,
      });
      (window as any).electronAPI = {
        assemblyAiStreamingForceEndpoint: vi.fn(),
        assemblyAiStreamingStop: vi.fn(() => teardown.promise),
      };
      localStorage.setItem("cloudTranscriptionMode", "echodraft");
      localStorage.setItem("isSignedIn", "true");
      localStorage.setItem("useLocalWhisper", "false");

      const manager = new AudioManager() as any;
      const processAudio = vi.fn(async () => undefined);
      manager.processAudio = processAudio;
      manager.getAudioConstraints = vi.fn(async () => ({ audio: true }));
      manager.setCallbacks({
        onStateChange: vi.fn(),
        onError: vi.fn(),
        onTranscriptionComplete: vi.fn(),
        onPartialTranscript: vi.fn(),
        onProgress: vi.fn(),
      });
      manager.isStreaming = true;
      manager.isRecording = true;
      manager.streamingFinalText = "cancel this dictation";

      const firstFinalization = manager.stopStreamingRecording();
      await vi.advanceTimersByTimeAsync(150);
      await vi.waitFor(() =>
        expect((window as any).electronAPI.assemblyAiStreamingStop).toHaveBeenCalledOnce()
      );
      expect(manager.cancelProcessing()).toBe(true);
      expect(manager.getState()).toMatchObject({ isProcessing: true, isStreaming: false });
      expect(manager.shouldUseStreaming()).toBe(true);

      await expect(
        manager.startRecording({ sessionId: "second", jobId: 2, outputMode: "clipboard" })
      ).resolves.toBe(true);
      const secondStop = manager.stopRecordingAndWaitForClose({
        reason: "manual",
        source: "hotkey",
        sessionId: "second",
        outputMode: "clipboard",
      });
      await vi.advanceTimersByTimeAsync(250);
      await expect(secondStop).resolves.toBe(true);

      expect(manager.getState()).toMatchObject({
        isProcessing: true,
        isStreaming: false,
        queuedProcessingJobs: 1,
      });
      expect(processAudio).not.toHaveBeenCalled();

      teardown.resolve({ success: true, text: "late text", terminationConfirmed: true });
      await expect(firstFinalization).resolves.toBe(false);
      await manager.processingQueue.whenIdle();

      expect(processAudio).toHaveBeenCalledOnce();
      expect(processAudio).toHaveBeenCalledWith(
        expect.any(Blob),
        expect.any(Object),
        expect.objectContaining({ sessionId: "second", jobId: 2 })
      );
      expect(manager.getState()).toMatchObject({ isProcessing: false, queuedProcessingJobs: 0 });
      manager.cleanup();
    } finally {
      (globalThis as any).MediaRecorder = originalMediaRecorder;
      Object.defineProperty(navigator, "mediaDevices", {
        value: originalMediaDevices,
        configurable: true,
      });
    }
  });

  it("settles an unexpected streaming delivery failure and runs the next queued job", async () => {
    vi.useFakeTimers();
    (window as any).electronAPI = {
      assemblyAiStreamingForceEndpoint: vi.fn(),
      assemblyAiStreamingStop: vi.fn(async () => ({
        success: true,
        text: "first dictation",
        terminationConfirmed: true,
      })),
    };

    const manager = new AudioManager() as any;
    const deliveryError = new Error("history write failed");
    const processAudio = vi.fn(async () => undefined);
    manager.processAudio = processAudio;
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError: vi.fn(),
      onTranscriptionComplete: vi.fn(async () => {
        throw deliveryError;
      }),
      onPartialTranscript: vi.fn(),
      onProgress: vi.fn(),
    });
    manager.isStreaming = true;
    manager.isRecording = true;
    manager.streamingFinalText = "first dictation";

    const firstFinalization = manager.stopStreamingRecording();
    const firstFailure = firstFinalization.catch((error: unknown) => error);
    manager.enqueueProcessingJob(
      new Blob(["second"]),
      {},
      { sessionId: "second", jobId: 2, outputMode: "clipboard" }
    );

    await vi.runAllTimersAsync();
    await expect(firstFailure).resolves.toBe(deliveryError);
    await manager.processingQueue.whenIdle();

    expect(processAudio).toHaveBeenCalledWith(
      expect.any(Blob),
      {},
      expect.objectContaining({ sessionId: "second", jobId: 2 })
    );
    expect(manager.getState()).toMatchObject({ isProcessing: false, queuedProcessingJobs: 0 });
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
