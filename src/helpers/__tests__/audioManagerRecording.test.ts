import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AudioManager from "../audioManager.js";
import { NON_STREAMING_STOP_EVENT_TIMEOUT_MS } from "../audio/recording/nonStreamingStopWatchdog.js";

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

  it("announces listening only after MediaRecorder starts successfully", async () => {
    class FailingMediaRecorder extends FakeMediaRecorder {
      start() {
        throw new Error("recorder start failed");
      }
    }
    (globalThis as any).MediaRecorder = FailingMediaRecorder;

    const fakeTrack = {
      label: "Fake Mic",
      stop: vi.fn(),
      getSettings: () => ({ deviceId: "fake", sampleRate: 48000, channelCount: 1 }),
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [fakeTrack],
          getAudioTracks: () => [fakeTrack],
        })),
      },
      configurable: true,
    });

    const manager = new AudioManager();
    const onProgress = vi.fn();
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError: vi.fn(),
      onTranscriptionComplete: vi.fn(),
      onPartialTranscript: vi.fn(),
      onProgress,
    });

    await expect(manager.startRecording({ sessionId: "failed-start" })).resolves.toBe(false);
    expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({ stage: "listening" }));
    expect(manager.getState().isRecording).toBe(false);
    expect(fakeTrack.stop).toHaveBeenCalledTimes(1);
    expect((manager as any).mediaRecorder).toBeNull();

    manager.cleanup();
  });

  it("labels a captured recording as queued when an earlier dictation is ahead", async () => {
    const manager = new AudioManager();
    const fakeTrack = {
      label: "Fake Mic",
      stop: vi.fn(),
      getSettings: () => ({ deviceId: "fake", sampleRate: 48000, channelCount: 1 }),
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [fakeTrack],
          getAudioTracks: () => [fakeTrack],
        })),
      },
      configurable: true,
    });

    (manager as any).enqueueProcessingJob = vi.fn(() => ({ jobsAhead: 2, position: 3 }));
    const onProgress = vi.fn();
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError: vi.fn(),
      onTranscriptionComplete: vi.fn(),
      onPartialTranscript: vi.fn(),
      onProgress,
    });

    await manager.startRecording({ sessionId: "queued-recording", jobId: 3, outputMode: "insert" });
    manager.stopRecording({
      reason: "manual",
      source: "manual",
      sessionId: "queued-recording",
      outputMode: "insert",
    });
    await vi.runAllTimersAsync();

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "queued",
        stageLabel: "Queued",
        message: "2 dictations ahead",
        recordingClosed: true,
      })
    );

    manager.cleanup();
  });

  it("emits one recording-closed transition after repeated delayed stop requests", async () => {
    class DelayedStopMediaRecorder extends FakeMediaRecorder {
      static latest: DelayedStopMediaRecorder | null = null;
      stopCalls = 0;

      constructor(stream: any) {
        super(stream);
        DelayedStopMediaRecorder.latest = this;
      }

      stop() {
        this.stopCalls += 1;
      }

      async completeStop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([], { type: this.mimeType }) });
        await this.onstop?.();
      }
    }
    (globalThis as any).MediaRecorder = DelayedStopMediaRecorder;

    const fakeTrack = {
      label: "Fake Mic",
      stop: vi.fn(),
      getSettings: () => ({ deviceId: "fake", sampleRate: 48000, channelCount: 1 }),
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [fakeTrack],
          getAudioTracks: () => [fakeTrack],
        })),
      },
      configurable: true,
    });

    const manager = new AudioManager();
    const onProgress = vi.fn();
    (manager as any).enqueueProcessingJob = vi.fn();
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError: vi.fn(),
      onTranscriptionComplete: vi.fn(),
      onPartialTranscript: vi.fn(),
      onProgress,
    });

    await manager.startRecording({ sessionId: "delayed-stop" });
    expect(manager.stopRecording({ reason: "manual" })).toBe(true);
    expect(manager.stopRecording({ reason: "manual" })).toBe(true);
    expect(DelayedStopMediaRecorder.latest?.stopCalls).toBe(1);
    expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({ recordingClosed: true }));

    const completedStop = DelayedStopMediaRecorder.latest?.completeStop();
    await vi.runAllTimersAsync();
    await completedStop;
    expect(onProgress.mock.calls.filter(([event]) => event?.recordingClosed === true)).toHaveLength(
      1
    );

    manager.cleanup();
  });

  it("waits for recorder closure and queue admission before resolving stop", async () => {
    class DelayedStopMediaRecorder extends FakeMediaRecorder {
      static latest: DelayedStopMediaRecorder | null = null;

      constructor(stream: any) {
        super(stream);
        DelayedStopMediaRecorder.latest = this;
      }

      stop() {}

      async completeStop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
        await this.onstop?.();
      }
    }
    (globalThis as any).MediaRecorder = DelayedStopMediaRecorder;

    const fakeTrack = {
      label: "Fake Mic",
      stop: vi.fn(),
      getSettings: () => ({ deviceId: "fake", sampleRate: 48000, channelCount: 1 }),
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [fakeTrack],
          getAudioTracks: () => [fakeTrack],
        })),
      },
      configurable: true,
    });

    const manager = new AudioManager();
    const enqueueProcessingJob = vi.fn(() => ({ jobsAhead: 0, position: 1 }));
    (manager as any).enqueueProcessingJob = enqueueProcessingJob;

    await manager.startRecording({ sessionId: "wait-for-close", outputMode: "insert" });
    const pendingStop = manager.stopRecordingAndWaitForClose({
      reason: "manual",
      sessionId: "wait-for-close",
    });
    let resolved = false;
    void pendingStop.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(enqueueProcessingJob).not.toHaveBeenCalled();

    const completedStop = DelayedStopMediaRecorder.latest?.completeStop();
    await vi.runAllTimersAsync();
    await completedStop;

    await expect(pendingStop).resolves.toBe(true);
    expect(enqueueProcessingJob).toHaveBeenCalledOnce();
    manager.cleanup();
  });

  it("retires a recorder whose stop event never arrives and ignores a late event", async () => {
    class MissingStopEventMediaRecorder extends FakeMediaRecorder {
      static instances: MissingStopEventMediaRecorder[] = [];

      constructor(stream: any) {
        super(stream);
        MissingStopEventMediaRecorder.instances.push(this);
      }

      stop() {
        // Simulate a browser/driver that accepts stop() but never dispatches onstop.
      }
    }
    (globalThis as any).MediaRecorder = MissingStopEventMediaRecorder;

    const fakeTrack = {
      label: "Fake Mic",
      stop: vi.fn(),
      getSettings: () => ({ deviceId: "fake", sampleRate: 48000, channelCount: 1 }),
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [fakeTrack],
          getAudioTracks: () => [fakeTrack],
        })),
      },
      configurable: true,
    });

    const manager = new AudioManager();
    const enqueueProcessingJob = vi.fn();
    const onError = vi.fn();
    (manager as any).enqueueProcessingJob = enqueueProcessingJob;
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError,
      onTranscriptionComplete: vi.fn(),
      onPartialTranscript: vi.fn(),
      onProgress: vi.fn(),
    });

    await manager.startRecording({ sessionId: "missing-stop", jobId: 1 });
    const firstRecorder = MissingStopEventMediaRecorder.instances[0];
    const lateOnStop = firstRecorder.onstop;
    const pendingStop = manager.stopRecordingAndWaitForClose({
      reason: "manual",
      sessionId: "missing-stop",
    });

    await vi.advanceTimersByTimeAsync(NON_STREAMING_STOP_EVENT_TIMEOUT_MS);
    await expect(pendingStop).resolves.toBe(false);
    expect(manager.getState().isRecording).toBe(false);
    expect((manager as any).mediaRecorder).toBeNull();
    expect(enqueueProcessingJob).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "RECORDER_STOP_TIMEOUT",
        context: expect.objectContaining({ sessionId: "missing-stop" }),
      })
    );

    await expect(manager.startRecording({ sessionId: "replacement", jobId: 2 })).resolves.toBe(
      true
    );
    const replacementRecorder = MissingStopEventMediaRecorder.instances[1];
    await lateOnStop?.();
    expect((manager as any).mediaRecorder).toBe(replacementRecorder);
    expect(manager.getState().isRecording).toBe(true);
    expect(enqueueProcessingJob).not.toHaveBeenCalled();

    expect(manager.cancelRecording()).toBe(true);
    await replacementRecorder.onstop?.();
  });

  it("retires cancellation without an onstop event and fences late callbacks", async () => {
    class MissingCancelStopEventMediaRecorder extends FakeMediaRecorder {
      static instances: MissingCancelStopEventMediaRecorder[] = [];
      delayedCancelOnStop: (() => any) | null = null;

      constructor(stream: any) {
        super(stream);
        MissingCancelStopEventMediaRecorder.instances.push(this);
      }

      stop() {
        this.state = "inactive";
        this.delayedCancelOnStop = this.onstop;
        // Simulate a browser/driver that queues, but never dispatches, onstop.
      }
    }
    (globalThis as any).MediaRecorder = MissingCancelStopEventMediaRecorder;

    const fakeTrack = {
      label: "Fake Mic",
      stop: vi.fn(),
      getSettings: () => ({ deviceId: "fake", sampleRate: 48000, channelCount: 1 }),
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [fakeTrack],
          getAudioTracks: () => [fakeTrack],
        })),
      },
      configurable: true,
    });

    const manager = new AudioManager();
    const enqueueProcessingJob = vi.fn();
    const onProgress = vi.fn();
    (manager as any).enqueueProcessingJob = enqueueProcessingJob;
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError: vi.fn(),
      onTranscriptionComplete: vi.fn(),
      onPartialTranscript: vi.fn(),
      onProgress,
    });

    await manager.startRecording({ sessionId: "cancel-missing-stop", jobId: 1 });
    const cancelledRecorder = MissingCancelStopEventMediaRecorder.instances[0];
    const originalOnStop = cancelledRecorder.onstop;

    expect(manager.cancelRecording()).toBe(true);
    expect(manager.getState().isRecording).toBe(false);
    expect((manager as any).mediaRecorder).toBeNull();
    expect(enqueueProcessingJob).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "cancelled", stageLabel: "Cancelled" })
    );

    await expect(
      manager.startRecording({ sessionId: "replacement-after-cancel", jobId: 2 })
    ).resolves.toBe(true);
    const replacementRecorder = MissingCancelStopEventMediaRecorder.instances[1];
    await originalOnStop?.();
    await cancelledRecorder.delayedCancelOnStop?.();
    expect((manager as any).mediaRecorder).toBe(replacementRecorder);
    expect(manager.getState().isRecording).toBe(true);
    expect(enqueueProcessingJob).not.toHaveBeenCalled();

    expect(manager.cancelRecording()).toBe(true);
    manager.cleanup();
  });

  it("settles closed state when queue admission fails", async () => {
    const fakeTrack = {
      label: "Fake Mic",
      stop: vi.fn(),
      getSettings: () => ({ deviceId: "fake", sampleRate: 48000, channelCount: 1 }),
    };
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [fakeTrack],
          getAudioTracks: () => [fakeTrack],
        })),
      },
      configurable: true,
    });

    const manager = new AudioManager();
    (manager as any).enqueueProcessingJob = vi.fn(() => {
      throw new Error("queue unavailable");
    });
    const onError = vi.fn();
    manager.setCallbacks({
      onStateChange: vi.fn(),
      onError,
      onTranscriptionComplete: vi.fn(),
      onPartialTranscript: vi.fn(),
      onProgress: vi.fn(),
    });

    await manager.startRecording({ sessionId: "queue-failed", outputMode: "insert" });
    const pendingStop = manager.stopRecordingAndWaitForClose({ reason: "manual" });
    await vi.runAllTimersAsync();

    await expect(pendingStop).resolves.toBe(false);
    expect(manager.getState().isRecording).toBe(false);
    expect((manager as any).mediaRecorder).toBeNull();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ sessionId: "queue-failed" }) })
    );
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
