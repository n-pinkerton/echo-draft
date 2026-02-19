import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startStreamingRecording } from "./assemblyAiStreamingStart";

describe("assemblyAiStreamingStart", () => {
  const originalMediaDevices = (navigator as any).mediaDevices;

  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = { assemblyAiStreamingStart: vi.fn() };
  });

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
    vi.restoreAllMocks();
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
});

