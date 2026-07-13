import { describe, expect, it, vi } from "vitest";

import {
  createRecordingOperationQueue,
  createStartRecordingHandler,
  createStopRecordingHandler,
} from "./recordingHandlers";

describe("recordingHandlers", () => {
  it("sets stage to starting before awaiting audio start", async () => {
    const calls: Array<{ name: string; args: any[] }> = [];
    const updateStage = vi.fn((...args: any[]) => calls.push({ name: "updateStage", args }));

    const audioManager = {
      getState: () => ({ isRecording: false, isProcessing: false }),
      shouldUseStreaming: () => false,
      startRecording: vi.fn(async () => {
        calls.push({ name: "startRecording", args: [] });
        return true;
      }),
      startStreamingRecording: vi.fn(async () => true),
    };

    const audioManagerRef = { current: audioManager };
    const sessionsByIdRef = { current: new Map() };
    const recordingSessionIdRef = { current: null as string | null };
    const activeSessionRef = { current: null as any };
    const sessionStartedAtRef = { current: null as number | null };
    const recordingStartedAtRef = { current: null as number | null };

    const upsertJob = vi.fn((_sessionId: string, _patch: any) => ({ jobId: 1 }));
    const removeJob = vi.fn();
    const normalizeTriggerPayload = (_payload: any) => ({
      outputMode: "insert",
      sessionId: "s-1",
      triggeredAt: 10,
      startedAt: null,
      releasedAt: null,
      insertionTarget: null,
      stopReason: null,
      stopSource: null,
    });

    const playStartCue = vi.fn();

    const start = createStartRecordingHandler({
      activeSessionRef,
      audioManagerRef,
      normalizeTriggerPayload,
      recordingSessionIdRef,
      recordingStartedAtRef,
      removeJob,
      sessionStartedAtRef,
      sessionsByIdRef,
      updateStage,
      upsertJob,
      playStartCue,
      electronAPI: { captureInsertionTarget: vi.fn(async () => ({ success: false })) },
    });

    await start({});

    expect(updateStage).toHaveBeenCalledWith(
      "starting",
      expect.objectContaining({ sessionId: "s-1", jobId: 1 })
    );
    expect(audioManager.startRecording).toHaveBeenCalled();
    expect(updateStage).toHaveBeenCalledWith(
      "listening",
      expect.objectContaining({ sessionId: "s-1", jobId: 1 })
    );
    expect(playStartCue).toHaveBeenCalled();

    const startingIndex = calls.findIndex(
      (c) => c.name === "updateStage" && c.args[0] === "starting"
    );
    const startRecordingIndex = calls.findIndex((c) => c.name === "startRecording");
    expect(startingIndex).toBeGreaterThanOrEqual(0);
    expect(startRecordingIndex).toBeGreaterThanOrEqual(0);
    expect(startingIndex).toBeLessThan(startRecordingIndex);
  });

  it("stops streaming recording while lifecycle progress owns the stop cue", async () => {
    const audioManager = {
      getState: () => ({ isRecording: true, isStreaming: true, isProcessing: false }),
      stopStreamingRecording: vi.fn(async () => true),
      stopRecording: vi.fn(() => true),
    };
    const audioManagerRef = { current: audioManager };
    const activeSessionRef = { current: { sessionId: "s-1", outputMode: "insert" } as any };
    const recordingSessionIdRef = { current: "s-1" as any };
    const latestProgressRef = { current: { recordedMs: 123 } };
    const upsertJob = vi.fn();
    const normalizeTriggerPayload = (payload: any) => ({
      outputMode: "insert",
      sessionId: payload?.sessionId || "s-1",
      triggeredAt: 1,
      startedAt: null,
      releasedAt: null,
      insertionTarget: null,
      stopReason: payload?.stopReason || null,
      stopSource: payload?.stopSource || null,
    });
    const stop = createStopRecordingHandler({
      activeSessionRef,
      audioManagerRef,
      latestProgressRef,
      normalizeTriggerPayload,
      recordingSessionIdRef,
      upsertJob,
    });

    await stop({ sessionId: "s-1" });

    expect(audioManager.stopStreamingRecording).toHaveBeenCalled();
  });

  it("preserves the active session when a tap stop payload has a fresh ID", async () => {
    const stopRecording = vi.fn(() => true);
    const audioManager = {
      getState: () => ({ isRecording: true, isStreaming: false, isProcessing: false }),
      stopStreamingRecording: vi.fn(),
      stopRecording,
    };
    const activeSessionRef = {
      current: {
        sessionId: "active-session",
        outputMode: "clipboard",
        triggeredAt: 10,
        insertionTarget: null,
      } as any,
    };
    const normalizeTriggerPayload = (payload: any) => ({
      outputMode: payload.outputMode,
      sessionId: payload.sessionId,
      triggeredAt: payload.triggeredAt,
      startedAt: null,
      releasedAt: null,
      insertionTarget: null,
      stopReason: null,
      stopSource: null,
    });
    const stop = createStopRecordingHandler({
      activeSessionRef,
      audioManagerRef: { current: audioManager },
      latestProgressRef: { current: {} },
      normalizeTriggerPayload,
      recordingSessionIdRef: { current: "active-session" },
      upsertJob: vi.fn(),
    });

    await stop({ sessionId: "new-toggle-id", outputMode: "insert", triggeredAt: 99 });

    expect(activeSessionRef.current.sessionId).toBe("active-session");
    expect(activeSessionRef.current.outputMode).toBe("clipboard");
    expect(stopRecording).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "active-session", outputMode: "clipboard" })
    );
  });

  it("serializes a forced stop behind delayed target capture and microphone startup", async () => {
    let resolveCapture!: (value: any) => void;
    let resolveStart!: (value: boolean) => void;
    const capture = new Promise((resolve) => {
      resolveCapture = resolve;
    });
    const microphoneStart = new Promise<boolean>((resolve) => {
      resolveStart = resolve;
    });
    let state = { isRecording: false, isStreaming: false, isProcessing: false };
    const stopRecording = vi.fn(() => {
      state = { ...state, isRecording: false };
      return true;
    });
    const audioManager = {
      getState: () => state,
      shouldUseStreaming: () => false,
      startRecording: vi.fn(async () => {
        const didStart = await microphoneStart;
        if (didStart) state = { ...state, isRecording: true };
        return didStart;
      }),
      startStreamingRecording: vi.fn(),
      stopStreamingRecording: vi.fn(),
      stopRecording,
    };
    const activeSessionRef = { current: null as any };
    const recordingSessionIdRef = { current: null as string | null };
    const normalizeTriggerPayload = (payload: any) => ({
      outputMode: "insert",
      sessionId: payload.sessionId,
      triggeredAt: 1,
      stopReason: payload.stopReason || null,
      stopSource: payload.stopSource || null,
    });
    const common = {
      activeSessionRef,
      audioManagerRef: { current: audioManager },
      normalizeTriggerPayload,
      recordingSessionIdRef,
      upsertJob: vi.fn(() => ({ jobId: 1 })),
    };
    const start = createStartRecordingHandler({
      ...common,
      recordingStartedAtRef: { current: null },
      removeJob: vi.fn(),
      sessionStartedAtRef: { current: null },
      sessionsByIdRef: { current: new Map() },
      updateStage: vi.fn(),
      playStartCue: vi.fn(),
      electronAPI: { captureInsertionTarget: vi.fn(() => capture) },
    });
    const stop = createStopRecordingHandler({
      ...common,
      latestProgressRef: { current: {} },
    });
    const queue = createRecordingOperationQueue();

    const startPromise = queue.run(() => start({ sessionId: "pending-session" }));
    const stopPromise = queue.run(() =>
      stop({
        sessionId: "pending-session",
        stopReason: "listener-exit",
        stopSource: "windows-native-listener",
      })
    );

    await Promise.resolve();
    expect(stopRecording).not.toHaveBeenCalled();
    resolveCapture({ success: false });
    await Promise.resolve();
    expect(audioManager.startRecording).toHaveBeenCalled();
    resolveStart(true);

    await Promise.all([startPromise, stopPromise]);
    expect(stopRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "pending-session",
        reason: "listener-exit",
        source: "windows-native-listener",
      })
    );
    expect(state.isRecording).toBe(false);
  });
});
