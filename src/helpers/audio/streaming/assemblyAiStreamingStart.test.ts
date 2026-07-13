import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  STREAMING_STARTUP_TIMEOUT_MS,
  startStreamingRecording,
} from "./assemblyAiStreamingStart";

describe("assemblyAiStreamingStart", () => {
  const originalMediaDevices = (navigator as any).mediaDevices;

  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = { assemblyAiStreamingStart: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  const createManager = (overrides: Record<string, unknown> = {}) => ({
    isRecording: false,
    isStreaming: false,
    isProcessing: false,
    cachedMicDeviceId: null,
    micDriverWarmedUp: false,
    streamingCleanupFns: [],
    streamingWorklet: { resolveFlushWaiter: vi.fn() },
    getAudioConstraints: vi.fn(async () => ({ audio: true })),
    withSessionRefresh: async (fn: any) => await fn(),
    emitError: vi.fn(),
    ...overrides,
  });

  it("returns false when already recording/streaming/processing", async () => {
    const manager: any = { isRecording: true, isStreaming: false, isProcessing: false };
    await expect(startStreamingRecording(manager)).resolves.toBe(false);
  });

  it("falls back to regular recording when NO_API is returned", async () => {
    const trackStop = vi.fn();
    const fakeTrack = {
      label: "Fake Mic",
      stop: trackStop,
      getSettings: () => ({ deviceId: "fake", sampleRate: 48000 }),
    };
    const fakeStream = {
      getTracks: () => [fakeTrack],
      getAudioTracks: () => [fakeTrack],
    };

    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(async () => fakeStream) },
      configurable: true,
    });

    const startRecording = vi.fn(async () => true);
    const withSessionRefresh = async (fn: any) => await fn();

    (window as any).electronAPI = {
      assemblyAiStreamingStart: vi.fn(async () => ({ success: false, code: "NO_API" })),
    };

    const manager: any = {
      isRecording: false,
      isStreaming: false,
      isProcessing: false,
      cachedMicDeviceId: null,
      micDriverWarmedUp: false,
      getAudioConstraints: vi.fn(async () => ({ audio: true })),
      withSessionRefresh,
      startRecording,
    };

    const didStart = await startStreamingRecording(manager, { sessionId: "s1" });
    expect(didStart).toBe(true);
    expect(startRecording).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalled();
  });

  it("stops an acquired microphone when backend startup fails", async () => {
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
    (window as any).electronAPI = {
      assemblyAiStreamingStart: vi.fn(async () => {
        throw new Error("backend unavailable");
      }),
      assemblyAiStreamingStop: vi.fn(),
    };

    await expect(startStreamingRecording(createManager() as any)).resolves.toBe(false);
    await vi.waitFor(() => expect(trackStop).toHaveBeenCalledOnce());
    expect((window as any).electronAPI.assemblyAiStreamingStop).not.toHaveBeenCalled();
  });

  it("stops a started backend when microphone startup fails", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(async () => Promise.reject(new Error("microphone failed"))) },
      configurable: true,
    });
    const assemblyAiStreamingStop = vi.fn(async () => ({ success: false }));
    (window as any).electronAPI = {
      assemblyAiStreamingStart: vi.fn(async () => ({ success: true })),
      assemblyAiStreamingStop,
    };

    await expect(startStreamingRecording(createManager() as any)).resolves.toBe(false);
    expect(assemblyAiStreamingStop).toHaveBeenCalledOnce();
  });

  it("releases an acquired microphone and clears startup state on backend timeout", async () => {
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
    (window as any).electronAPI = {
      assemblyAiStreamingStart: vi.fn(async () => ({
        success: false,
        code: "STREAMING_TOKEN_TIMEOUT",
        error: "The streaming service could not be started",
      })),
      assemblyAiStreamingStop: vi.fn(),
    };
    const manager = createManager() as any;

    await expect(startStreamingRecording(manager)).resolves.toBe(false);

    await vi.waitFor(() => expect(trackStop).toHaveBeenCalledOnce());
    expect(manager.streamingStartInProgress).toBe(false);
    expect(manager.streamingStartAbortController).toBeNull();
    expect((window as any).electronAPI.assemblyAiStreamingStop).not.toHaveBeenCalled();
  });

  it("clears startup state before a late microphone request settles after backend timeout", async () => {
    let resolveMicrophone!: (stream: any) => void;
    const trackStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveMicrophone = resolve;
            })
        ),
      },
      configurable: true,
    });
    (window as any).electronAPI = {
      assemblyAiStreamingStart: vi.fn(async () => ({
        success: false,
        code: "STREAMING_TOKEN_TIMEOUT",
        error: "The streaming service could not be started",
      })),
      assemblyAiStreamingStop: vi.fn(),
    };
    const manager = createManager() as any;

    await expect(startStreamingRecording(manager)).resolves.toBe(false);
    expect(manager.streamingStartInProgress).toBe(false);
    expect(manager.streamingStartAbortController).toBeNull();

    resolveMicrophone({
      getTracks: () => [{ stop: trackStop }],
      getAudioTracks: () => [],
    });
    await vi.waitFor(() => expect(trackStop).toHaveBeenCalledOnce());
  });

  it("fails closed and releases the microphone when backend completion is late after cancel", async () => {
    let resolveBackend!: (value: any) => void;
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
    const assemblyAiStreamingStop = vi.fn(async () => ({ success: false }));
    (window as any).electronAPI = {
      assemblyAiStreamingStart: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveBackend = resolve;
          })
      ),
      assemblyAiStreamingStop,
    };
    const manager = createManager() as any;

    const start = startStreamingRecording(manager);
    await vi.waitFor(() =>
      expect(manager.streamingStartAbortController).toBeInstanceOf(AbortController)
    );
    manager.streamingStartAbortController.abort(new Error("cancelled"));
    resolveBackend({ success: true, usedWarmConnection: true });

    await expect(start).resolves.toBe(false);
    expect(trackStop).toHaveBeenCalledOnce();
    expect(assemblyAiStreamingStop).toHaveBeenCalledOnce();
    expect(manager.streamingStartInProgress).toBe(false);
    expect(manager.isStreaming).toBe(false);
  });

  it("serializes overlapping renderer startup attempts", async () => {
    let releaseMicrophone!: (stream: any) => void;
    const microphone = new Promise<any>((resolve) => {
      releaseMicrophone = resolve;
    });
    const trackStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(() => microphone) },
      configurable: true,
    });
    (window as any).electronAPI = {
      assemblyAiStreamingStart: vi.fn(async () => ({ success: false, code: "NO_API" })),
    };
    const manager = createManager({ startRecording: vi.fn(async () => true) }) as any;

    const first = startStreamingRecording(manager);
    await vi.waitFor(() => expect(manager.streamingStartInProgress).toBe(true));
    await expect(startStreamingRecording(manager)).resolves.toBe(false);
    releaseMicrophone({
      getTracks: () => [{ stop: trackStop }],
      getAudioTracks: () => [],
    });

    await expect(first).resolves.toBe(true);
    expect((window as any).electronAPI.assemblyAiStreamingStart).toHaveBeenCalledOnce();
    expect(manager.streamingStartInProgress).toBe(false);
  });

  it("applies one startup deadline to auth refresh and microphone acquisition", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn(() => new Promise(() => {})) },
      configurable: true,
    });
    const withSessionRefresh = vi.fn(
      (_operation: any, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        })
    );
    const assemblyAiStreamingStart = vi.fn();
    const assemblyAiStreamingStop = vi.fn(async () => ({ success: false }));
    (window as any).electronAPI = { assemblyAiStreamingStart, assemblyAiStreamingStop };
    const manager = createManager({ withSessionRefresh }) as any;

    const startup = startStreamingRecording(manager);
    await vi.advanceTimersByTimeAsync(STREAMING_STARTUP_TIMEOUT_MS);

    await expect(startup).resolves.toBe(false);
    expect(withSessionRefresh).toHaveBeenCalledWith(expect.any(Function), {
      signal: expect.any(AbortSignal),
    });
    expect(assemblyAiStreamingStart).not.toHaveBeenCalled();
    expect(assemblyAiStreamingStop).toHaveBeenCalledOnce();
    expect(manager.streamingStartInProgress).toBe(false);
    expect(manager.streamingStartAbortController).toBeNull();
    expect(manager.isRecording).toBe(false);
  });
});
