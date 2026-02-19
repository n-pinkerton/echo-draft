import { describe, expect, it, vi } from "vitest";

import { createTranscriptionCompleteHandler } from "./transcriptionCompleteHandler";

describe("createTranscriptionCompleteHandler", () => {
  it("handles clipboard mode: writes clipboard, saves history, updates stage", async () => {
    const activeSessionRef = { current: null as any };
    const sessionsByIdRef = { current: new Map() };
    const jobsBySessionIdRef = {
      current: new Map([
        [
          "s-1",
          {
            sessionId: "s-1",
            jobId: 1,
            startedAt: Date.now() - 1000,
            recordedMs: 500,
            provider: "openai",
            model: "gpt-4o-mini",
          },
        ],
      ]),
    };
    const recordingSessionIdRef = { current: null as any };
    const audioManagerRef = {
      current: {
        safePaste: vi.fn(async () => true),
        saveTranscription: vi.fn(async () => ({ success: true, id: 123 })),
        warmupStreamingConnection: vi.fn(),
      },
    };

    const updateStage = vi.fn();
    const upsertJob = vi.fn();
    const removeJob = vi.fn();
    const setTranscript = vi.fn();
    const setProgress = vi.fn();
    const toast = vi.fn();

    const electronAPI = {
      writeClipboard: vi.fn(async () => {}),
      patchTranscriptionMeta: vi.fn(async () => {}),
    };

    const normalizeTriggerPayload = (payload: any) => ({
      outputMode: payload?.outputMode === "clipboard" ? "clipboard" : "insert",
      sessionId: payload?.sessionId || "s-x",
      triggeredAt: 1,
      startedAt: null,
      releasedAt: null,
      insertionTarget: null,
      stopReason: null,
      stopSource: null,
    });

    const handler = createTranscriptionCompleteHandler({
      activeSessionRef,
      audioManagerRef,
      jobsBySessionIdRef,
      normalizeTriggerPayload,
      recordingSessionIdRef,
      removeJob,
      sessionsByIdRef,
      setProgress,
      setTranscript,
      toast,
      updateStage,
      upsertJob,
      electronAPI,
      localStorage: { getItem: () => null },
    });

    await handler({
      success: true,
      text: "hello world",
      rawText: "hello world",
      source: "openai",
      timings: {},
      context: { sessionId: "s-1", jobId: 1, outputMode: "clipboard" },
    });

    expect(electronAPI.writeClipboard).toHaveBeenCalledWith("hello world");
    expect(audioManagerRef.current.saveTranscription).toHaveBeenCalled();
    expect(updateStage).toHaveBeenCalledWith("saving", expect.objectContaining({ sessionId: "s-1" }));
    expect(updateStage).toHaveBeenCalledWith("done", expect.objectContaining({ sessionId: "s-1" }));
    expect(audioManagerRef.current.warmupStreamingConnection).toHaveBeenCalled();
  });

  it("handles insert mode: pastes into target, saves history, updates stage", async () => {
    const activeSessionRef = { current: null as any };
    const sessionsByIdRef = {
      current: new Map([
        [
          "s-1",
          {
            sessionId: "s-1",
            outputMode: "insert",
            insertionTarget: { hwnd: 99 },
            triggeredAt: 1,
          },
        ],
      ]),
    };
    const jobsBySessionIdRef = { current: new Map([["s-1", { sessionId: "s-1", jobId: 1 }]]) };
    const recordingSessionIdRef = { current: null as any };
    const audioManagerRef = {
      current: {
        safePaste: vi.fn(async () => true),
        saveTranscription: vi.fn(async () => ({ success: true, transcription: { id: 555 } })),
        warmupStreamingConnection: vi.fn(),
      },
    };

    const updateStage = vi.fn();
    const upsertJob = vi.fn();
    const removeJob = vi.fn();
    const setTranscript = vi.fn();
    const setProgress = vi.fn();
    const toast = vi.fn();

    const electronAPI = {
      patchTranscriptionMeta: vi.fn(async () => {}),
    };

    const normalizeTriggerPayload = (payload: any) => ({
      outputMode: payload?.outputMode === "clipboard" ? "clipboard" : "insert",
      sessionId: payload?.sessionId || "s-x",
      triggeredAt: 1,
      startedAt: null,
      releasedAt: null,
      insertionTarget: null,
      stopReason: null,
      stopSource: null,
    });

    const handler = createTranscriptionCompleteHandler({
      activeSessionRef,
      audioManagerRef,
      jobsBySessionIdRef,
      normalizeTriggerPayload,
      recordingSessionIdRef,
      removeJob,
      sessionsByIdRef,
      setProgress,
      setTranscript,
      toast,
      updateStage,
      upsertJob,
      electronAPI,
      localStorage: { getItem: () => null },
    });

    await handler({
      success: true,
      text: "insert me",
      rawText: "insert me",
      source: "streaming-openai",
      timings: {},
      context: { sessionId: "s-1", jobId: 1, outputMode: "insert" },
    });

    expect(audioManagerRef.current.safePaste).toHaveBeenCalledWith(
      "insert me",
      expect.objectContaining({ fromStreaming: true, insertionTarget: { hwnd: 99 } })
    );
    expect(audioManagerRef.current.saveTranscription).toHaveBeenCalled();
    expect(updateStage).toHaveBeenCalledWith(
      "inserting",
      expect.objectContaining({ sessionId: "s-1", jobId: 1 })
    );
    expect(updateStage).toHaveBeenCalledWith("saving", expect.objectContaining({ sessionId: "s-1" }));
    expect(updateStage).toHaveBeenCalledWith("done", expect.objectContaining({ sessionId: "s-1" }));
  });
});

