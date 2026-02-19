import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AudioManager from "../audioManager.js";

class FakeMediaRecorder {
  stream: any;
  state: string;
  mimeType: string;
  ondataavailable: ((event: any) => void) | null;
  onstop: (() => any) | null;

  constructor(stream: any) {
    this.stream = stream;
    this.state = "inactive";
    this.mimeType = "audio/webm;codecs=opus";
    this.ondataavailable = null;
    this.onstop = null;
  }

  start() {
    this.state = "recording";
  }

  requestData() {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType });
    this.ondataavailable?.({ data: blob });
  }

  stop() {
    this.state = "inactive";
    const finalBlob = new Blob([], { type: this.mimeType });
    this.ondataavailable?.({ data: finalBlob });
    return this.onstop?.();
  }
}

describe("AudioManager (non-streaming recording contract)", () => {
  const originalMediaRecorder = (globalThis as any).MediaRecorder;
  const originalMediaDevices = (navigator as any).mediaDevices;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    (window as any).electronAPI = {};

    (globalThis as any).MediaRecorder = FakeMediaRecorder;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
    });
    (globalThis as any).MediaRecorder = originalMediaRecorder;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("records via MediaRecorder and enqueues a processing job on stop", async () => {
    const manager = new AudioManager();

    const trackStop = vi.fn();
    const fakeTrack = {
      label: "Fake Mic",
      stop: trackStop,
      getSettings: () => ({ deviceId: "fake", sampleRate: 48000, channelCount: 1 }),
    };
    const fakeStream = {
      getTracks: () => [fakeTrack],
      getAudioTracks: () => [fakeTrack],
    };

    const getUserMedia = vi.fn(async () => fakeStream);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    const enqueueProcessingJob = vi.fn();
    (manager as any).enqueueProcessingJob = enqueueProcessingJob;

    vi.setSystemTime(new Date("2026-02-19T00:00:00.000Z"));
    const startContext = {
      sessionId: "s-1",
      jobId: 1,
      outputMode: "clipboard",
      triggeredAt: Date.now() - 150,
    };
    const didStart = await manager.startRecording({
      ...startContext,
    });
    expect(didStart).toBe(true);
    expect(manager.getState().isRecording).toBe(true);

    vi.advanceTimersByTime(1000);

    const didStop = manager.stopRecording({
      reason: "manual",
      source: "manual",
      sessionId: "s-1",
      outputMode: "clipboard",
    });
    expect(didStop).toBe(true);

    await vi.runAllTimersAsync();

    expect(enqueueProcessingJob).toHaveBeenCalledTimes(1);
    const [audioBlob, metadata, context] = enqueueProcessingJob.mock.calls[0];
    expect(audioBlob).toBeInstanceOf(Blob);
    expect(audioBlob.size).toBeGreaterThan(0);
    expect(metadata.hotkeyToStartCallMs).toBe(150);
    expect(metadata.hotkeyToRecorderStartMs).toBe(150);
    expect(typeof metadata.startConstraintsMs).toBe("number");
    expect(typeof metadata.startGetUserMediaMs).toBe("number");
    expect(typeof metadata.startMediaRecorderInitMs).toBe("number");
    expect(typeof metadata.startMediaRecorderStartMs).toBe("number");
    expect(typeof metadata.startTotalMs).toBe("number");
    expect(metadata.stopReason).toBe("manual");
    expect(metadata.stopSource).toBe("manual");
    expect(typeof metadata.durationSeconds).toBe("number");
    expect(context).toEqual(startContext);

    expect(trackStop).toHaveBeenCalled();

    manager.cleanup();
  });

  it("uses track-ended stop reason when MediaRecorder stops after stream ends", async () => {
    const manager = new AudioManager();

    const trackStop = vi.fn();
    const fakeTrack: any = {
      label: "Fake Mic",
      stop: trackStop,
      getSettings: () => ({ deviceId: "fake", sampleRate: 48000, channelCount: 1 }),
      onended: null,
    };
    const fakeStream = {
      getTracks: () => [fakeTrack],
      getAudioTracks: () => [fakeTrack],
    };

    const getUserMedia = vi.fn(async () => fakeStream);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    const enqueueProcessingJob = vi.fn();
    (manager as any).enqueueProcessingJob = enqueueProcessingJob;

    const didStart = await manager.startRecording({
      sessionId: "s-3",
      jobId: 3,
      outputMode: "insert",
    });
    expect(didStart).toBe(true);

    fakeTrack.onended?.();
    (manager as any).mediaRecorder?.stop();

    await vi.runAllTimersAsync();

    expect(enqueueProcessingJob).toHaveBeenCalledTimes(1);
    const [_audioBlob, metadata] = enqueueProcessingJob.mock.calls[0];
    expect(metadata.stopReason).toBe("track-ended");
    expect(metadata.stopSource).toBe("track-ended");
    expect(typeof metadata.stopRequestedAt).toBe("number");
    expect(trackStop).toHaveBeenCalled();

    manager.cleanup();
  });

  it("cancelRecording stops capture without enqueueing a job", async () => {
    const manager = new AudioManager();

    const trackStop = vi.fn();
    const fakeTrack = {
      label: "Fake Mic",
      stop: trackStop,
      getSettings: () => ({ deviceId: "fake", sampleRate: 48000, channelCount: 1 }),
    };
    const fakeStream = {
      getTracks: () => [fakeTrack],
      getAudioTracks: () => [fakeTrack],
    };

    const getUserMedia = vi.fn(async () => fakeStream);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });

    const enqueueProcessingJob = vi.fn();
    (manager as any).enqueueProcessingJob = enqueueProcessingJob;

    const didStart = await manager.startRecording({
      sessionId: "s-2",
      jobId: 2,
      outputMode: "clipboard",
    });
    expect(didStart).toBe(true);

    const didCancel = manager.cancelRecording();
    expect(didCancel).toBe(true);

    await vi.runAllTimersAsync();

    expect(enqueueProcessingJob).not.toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalled();

    manager.cleanup();
  });
});
