import { describe, expect, it, vi } from "vitest";

import { createStartRecordingHandler, createStopRecordingHandler } from "./recordingHandlers";

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

    const startingIndex = calls.findIndex((c) => c.name === "updateStage" && c.args[0] === "starting");
    const startRecordingIndex = calls.findIndex((c) => c.name === "startRecording");
    expect(startingIndex).toBeGreaterThanOrEqual(0);
    expect(startRecordingIndex).toBeGreaterThanOrEqual(0);
    expect(startingIndex).toBeLessThan(startRecordingIndex);
  });

  it("stops streaming recording and plays stop cue", async () => {
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
    const playStopCue = vi.fn();

    const stop = createStopRecordingHandler({
      activeSessionRef,
      audioManagerRef,
      latestProgressRef,
      normalizeTriggerPayload,
      recordingSessionIdRef,
      upsertJob,
      playStopCue,
    });

    await stop({ sessionId: "s-1" });

    expect(audioManager.stopStreamingRecording).toHaveBeenCalled();
    expect(playStopCue).toHaveBeenCalled();
  });
});

