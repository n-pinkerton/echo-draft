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
    let resolveFinalization!: (value: boolean) => void;
    const finalization = new Promise<boolean>((resolve) => {
      resolveFinalization = resolve;
    });
    const audioManager = {
      getState: () => ({ isRecording: true, isStreaming: true, isProcessing: false }),
      stopStreamingRecording: vi.fn(() => finalization),
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

    await expect(stop({ sessionId: "s-1" })).resolves.toBe(true);

    expect(audioManager.stopStreamingRecording).toHaveBeenCalled();
    resolveFinalization(true);
  });

  it("releases the operation lane after streaming microphone closure, before finalization", async () => {
    let resolveFinalization!: (value: boolean) => void;
    const finalization = new Promise<boolean>((resolve) => {
      resolveFinalization = resolve;
    });
    let state = {
      isRecording: true,
      isStreaming: true,
      isProcessing: false,
      queuedProcessingJobs: 0,
    };
    const startRecording = vi.fn(async () => {
      state = { ...state, isRecording: true };
      return true;
    });
    const audioManager = {
      getState: () => state,
      shouldUseStreaming: () => true,
      stopStreamingRecording: vi.fn(() => {
        state = { ...state, isRecording: false, isStreaming: false, isProcessing: true };
        return finalization;
      }),
      stopRecording: vi.fn(),
      startRecording,
      startStreamingRecording: vi.fn(),
    };
    const activeSessionRef = {
      current: { sessionId: "first", outputMode: "insert", triggeredAt: 1 } as any,
    };
    const recordingSessionIdRef = { current: "first" as string | null };
    const normalizeTriggerPayload = (payload: any) => ({
      outputMode: payload.outputMode || "insert",
      sessionId: payload.sessionId,
      triggeredAt: payload.triggeredAt || 1,
    });
    const common = {
      activeSessionRef,
      audioManagerRef: { current: audioManager },
      normalizeTriggerPayload,
      recordingSessionIdRef,
      upsertJob: vi.fn(() => ({ jobId: 2 })),
    };
    const stop = createStopRecordingHandler({
      ...common,
      latestProgressRef: { current: { recordedMs: 500 } },
    });
    const start = createStartRecordingHandler({
      ...common,
      recordingStartedAtRef: { current: null },
      removeJob: vi.fn(),
      sessionStartedAtRef: { current: null },
      sessionsByIdRef: { current: new Map() },
      updateStage: vi.fn(),
      playStartCue: vi.fn(),
      electronAPI: { captureInsertionTarget: vi.fn(async () => ({ success: false })) },
    });
    const queue = createRecordingOperationQueue();

    await queue.run(() => stop({ sessionId: "first" }));
    await queue.run(() => start({ sessionId: "second", outputMode: "insert" }));

    expect(startRecording).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "second", outputMode: "insert" })
    );
    expect(audioManager.startStreamingRecording).not.toHaveBeenCalled();
    resolveFinalization(true);
  });

  it("waits for a non-streaming recording to close and enqueue before starting the next", async () => {
    let resolveClose!: (value: boolean) => void;
    const closed = new Promise<boolean>((resolve) => {
      resolveClose = resolve;
    });
    let state = { isRecording: true, isStreaming: false, isProcessing: false };
    const startRecording = vi.fn(async () => {
      state = { ...state, isRecording: true };
      return true;
    });
    const audioManager = {
      getState: () => state,
      shouldUseStreaming: () => false,
      stopRecordingAndWaitForClose: vi.fn(async () => {
        const didClose = await closed;
        state = { ...state, isRecording: false, isProcessing: true };
        return didClose;
      }),
      stopRecording: vi.fn(),
      stopStreamingRecording: vi.fn(),
      startRecording,
      startStreamingRecording: vi.fn(),
    };
    const activeSessionRef = {
      current: { sessionId: "first", outputMode: "insert", triggeredAt: 1 } as any,
    };
    const recordingSessionIdRef = { current: "first" as string | null };
    const normalizeTriggerPayload = (payload: any) => ({
      outputMode: payload.outputMode || "insert",
      sessionId: payload.sessionId,
      triggeredAt: payload.triggeredAt || 1,
    });
    const common = {
      activeSessionRef,
      audioManagerRef: { current: audioManager },
      normalizeTriggerPayload,
      recordingSessionIdRef,
      upsertJob: vi.fn(() => ({ jobId: 2 })),
    };
    const stop = createStopRecordingHandler({
      ...common,
      latestProgressRef: { current: { recordedMs: 500 } },
    });
    const start = createStartRecordingHandler({
      ...common,
      recordingStartedAtRef: { current: null },
      removeJob: vi.fn(),
      sessionStartedAtRef: { current: null },
      sessionsByIdRef: { current: new Map() },
      updateStage: vi.fn(),
      playStartCue: vi.fn(),
      electronAPI: { captureInsertionTarget: vi.fn(async () => ({ success: false })) },
    });
    const queue = createRecordingOperationQueue();

    const stopPromise = queue.run(() => stop({ sessionId: "first" }));
    const startPromise = queue.run(() =>
      start({ sessionId: "second", outputMode: "insert", triggeredAt: 2 })
    );
    await Promise.resolve();
    expect(startRecording).not.toHaveBeenCalled();

    resolveClose(true);
    await Promise.all([stopPromise, startPromise]);
    expect(startRecording).toHaveBeenCalledOnce();
  });

  it("allows insert-mode recording during processing and queues it as non-streaming audio", async () => {
    const startRecording = vi.fn(async () => true);
    const startStreamingRecording = vi.fn(async () => true);
    const audioManager = {
      getState: () => ({
        isRecording: false,
        isStreaming: false,
        isProcessing: true,
        queuedProcessingJobs: 1,
      }),
      shouldUseStreaming: () => true,
      startRecording,
      startStreamingRecording,
    };
    const session = {
      outputMode: "insert",
      sessionId: "stacked-insert",
      triggeredAt: 10,
      insertionTarget: null,
    };
    const updateStage = vi.fn();
    const start = createStartRecordingHandler({
      activeSessionRef: { current: null },
      audioManagerRef: { current: audioManager },
      normalizeTriggerPayload: () => session,
      recordingSessionIdRef: { current: null },
      recordingStartedAtRef: { current: null },
      removeJob: vi.fn(),
      sessionStartedAtRef: { current: null },
      sessionsByIdRef: { current: new Map() },
      updateStage,
      upsertJob: vi.fn(() => ({ jobId: 2 })),
      playStartCue: vi.fn(),
      electronAPI: { captureInsertionTarget: vi.fn(async () => ({ success: false })) },
    });

    await expect(start({ outputMode: "insert" })).resolves.toBe(true);

    expect(startRecording).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "stacked-insert", outputMode: "insert", jobId: 2 })
    );
    expect(startStreamingRecording).not.toHaveBeenCalled();
    expect(updateStage).toHaveBeenCalledWith(
      "listening",
      expect.objectContaining({ message: "Previous dictation processing" })
    );
  });

  it("marks a stopped insert-mode recording as queued behind active processing", async () => {
    const audioManager = {
      getState: () => ({ isRecording: true, isStreaming: false, isProcessing: true }),
      stopStreamingRecording: vi.fn(),
      stopRecording: vi.fn(() => true),
    };
    const upsertJob = vi.fn();
    const stop = createStopRecordingHandler({
      activeSessionRef: {
        current: { sessionId: "stacked-insert", outputMode: "insert", triggeredAt: 1 },
      },
      audioManagerRef: { current: audioManager },
      latestProgressRef: { current: { recordedMs: 1_250 } },
      normalizeTriggerPayload: (payload: any) => ({
        outputMode: payload.outputMode || "insert",
        sessionId: payload.sessionId || "stacked-insert",
        triggeredAt: payload.triggeredAt || 1,
      }),
      recordingSessionIdRef: { current: "stacked-insert" },
      upsertJob,
    });

    await expect(stop({ sessionId: "fresh-toggle-id" })).resolves.toBe(true);

    expect(upsertJob).toHaveBeenCalledWith(
      "stacked-insert",
      expect.objectContaining({ status: "queued", recordedMs: 1_250 })
    );
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
