import { beforeEach, describe, expect, it, vi } from "vitest";

const { errorLog, traceLog } = vi.hoisted(() => ({
  errorLog: vi.fn(),
  traceLog: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  default: {
    error: errorLog,
    trace: traceLog,
  },
}));

vi.mock("../../utils/branding", () => ({
  getRendererLogLevel: () => "trace",
}));

import { createAudioManagerCallbacks } from "./audioManagerCallbacks";

describe("createAudioManagerCallbacks", () => {
  beforeEach(() => {
    errorLog.mockClear();
    traceLog.mockClear();
  });

  it("plays the process cue only from a confirmed recording-closed progress event", () => {
    const playStopCue = vi.fn();
    const callbacks = createAudioManagerCallbacks({
      activeSessionRef: { current: null },
      audioManagerRef: { current: null },
      sessionsByIdRef: { current: new Map() },
      recordingSessionIdRef: { current: null },
      removeJob: vi.fn(),
      setIsProcessing: vi.fn(),
      setIsRecording: vi.fn(),
      setIsStreaming: vi.fn(),
      setPartialTranscript: vi.fn(),
      setProgress: vi.fn(),
      toast: vi.fn(),
      updateStage: vi.fn(),
      upsertJob: vi.fn(),
      onTranscriptionComplete: vi.fn(),
      playErrorCue: vi.fn(),
      playStopCue,
    });

    callbacks.onProgress({ stage: "transcribing", recordingClosed: false });
    expect(playStopCue).not.toHaveBeenCalled();

    callbacks.onProgress({ stage: "transcribing", recordingClosed: true });
    expect(playStopCue).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer active recording intact when an earlier queued job fails", () => {
    const activeSessionRef = { current: { sessionId: "new-recording" } };
    const recordingSessionIdRef = { current: "new-recording" };
    const sessionsByIdRef = {
      current: new Map([
        ["old-processing", { sessionId: "old-processing" }],
        ["new-recording", { sessionId: "new-recording" }],
      ]),
    };
    const updateStage = vi.fn();
    const playErrorCue = vi.fn();
    const callbacks = createAudioManagerCallbacks({
      activeSessionRef,
      audioManagerRef: { current: null },
      sessionsByIdRef,
      recordingSessionIdRef,
      removeJob: vi.fn(),
      setIsProcessing: vi.fn(),
      setIsRecording: vi.fn(),
      setIsStreaming: vi.fn(),
      setPartialTranscript: vi.fn(),
      setProgress: vi.fn(),
      toast: vi.fn(),
      updateStage,
      upsertJob: vi.fn(),
      onTranscriptionComplete: vi.fn(),
      playErrorCue,
      playStopCue: vi.fn(),
    });

    callbacks.onError({
      title: "Transcription Error",
      description: "Earlier job failed",
      context: { sessionId: "old-processing" },
    });

    expect(activeSessionRef.current).toEqual({ sessionId: "new-recording" });
    expect(recordingSessionIdRef.current).toBe("new-recording");
    expect(sessionsByIdRef.current.has("old-processing")).toBe(false);
    expect(sessionsByIdRef.current.has("new-recording")).toBe(true);
    expect(updateStage).not.toHaveBeenCalled();
    expect(playErrorCue).not.toHaveBeenCalled();
  });

  it("retires only a timed-out recorder job and leaves a replacement recording unqueued", () => {
    const activeSessionRef = { current: { sessionId: "replacement-recording" } };
    const recordingSessionIdRef = { current: "replacement-recording" };
    const sessionsByIdRef = {
      current: new Map([
        ["timed-out-recording", { sessionId: "timed-out-recording" }],
        ["replacement-recording", { sessionId: "replacement-recording" }],
      ]),
    };
    const jobsBySessionId = new Map([
      ["timed-out-recording", { sessionId: "timed-out-recording", status: "processing" }],
      ["replacement-recording", { sessionId: "replacement-recording", status: "recording" }],
    ]);
    const removeJob = vi.fn((sessionId: string) => jobsBySessionId.delete(sessionId));
    const updateStage = vi.fn();
    const playErrorCue = vi.fn();
    const callbacks = createAudioManagerCallbacks({
      activeSessionRef,
      audioManagerRef: { current: null },
      sessionsByIdRef,
      recordingSessionIdRef,
      removeJob,
      setIsProcessing: vi.fn(),
      setIsRecording: vi.fn(),
      setIsStreaming: vi.fn(),
      setPartialTranscript: vi.fn(),
      setProgress: vi.fn(),
      toast: vi.fn(),
      updateStage,
      upsertJob: vi.fn(),
      onTranscriptionComplete: vi.fn(),
      playErrorCue,
      playStopCue: vi.fn(),
    });

    callbacks.onError({
      code: "RECORDER_STOP_TIMEOUT",
      title: "Recording could not close",
      description: "That recording could not be finalized.",
      context: { sessionId: "timed-out-recording" },
    });

    expect(removeJob).toHaveBeenCalledWith("timed-out-recording");
    expect(sessionsByIdRef.current.has("timed-out-recording")).toBe(false);
    expect(jobsBySessionId.has("timed-out-recording")).toBe(false);
    expect(activeSessionRef.current).toEqual({ sessionId: "replacement-recording" });
    expect(recordingSessionIdRef.current).toBe("replacement-recording");
    expect(sessionsByIdRef.current.has("replacement-recording")).toBe(true);
    expect(jobsBySessionId.get("replacement-recording")?.status).toBe("recording");
    expect(
      [...jobsBySessionId.values()].filter(
        (job) => job.status === "processing" || job.status === "queued"
      )
    ).toHaveLength(0);
    expect(updateStage).not.toHaveBeenCalled();
    expect(playErrorCue).not.toHaveBeenCalled();
  });

  it("shows a truthful queued job status", () => {
    const upsertJob = vi.fn();
    const updateStage = vi.fn();
    const callbacks = createAudioManagerCallbacks({
      activeSessionRef: { current: null },
      audioManagerRef: { current: null },
      sessionsByIdRef: { current: new Map() },
      recordingSessionIdRef: { current: null },
      removeJob: vi.fn(),
      setIsProcessing: vi.fn(),
      setIsRecording: vi.fn(),
      setIsStreaming: vi.fn(),
      setPartialTranscript: vi.fn(),
      setProgress: vi.fn(),
      toast: vi.fn(),
      updateStage,
      upsertJob,
      onTranscriptionComplete: vi.fn(),
      playErrorCue: vi.fn(),
      playStopCue: vi.fn(),
    });

    callbacks.onProgress({
      stage: "queued",
      stageLabel: "Queued",
      message: "1 dictation ahead",
      context: { sessionId: "queued-session", outputMode: "insert" },
      jobId: 2,
    });

    expect(upsertJob).toHaveBeenCalledWith(
      "queued-session",
      expect.objectContaining({ status: "queued", jobId: 2 })
    );
    expect(updateStage).toHaveBeenCalledWith(
      "queued",
      expect.objectContaining({ sessionId: "queued-session", message: "1 dictation ahead" })
    );
  });

  it("ignores late partial text from an earlier streaming job during a newer recording", () => {
    const setPartialTranscript = vi.fn();
    const setProgress = vi.fn();
    const callbacks = createAudioManagerCallbacks({
      activeSessionRef: { current: { sessionId: "new-recording" } },
      audioManagerRef: { current: null },
      sessionsByIdRef: { current: new Map() },
      recordingSessionIdRef: { current: "new-recording" },
      removeJob: vi.fn(),
      setIsProcessing: vi.fn(),
      setIsRecording: vi.fn(),
      setIsStreaming: vi.fn(),
      setPartialTranscript,
      setProgress,
      toast: vi.fn(),
      updateStage: vi.fn(),
      upsertJob: vi.fn(),
      onTranscriptionComplete: vi.fn(),
      playErrorCue: vi.fn(),
      playStopCue: vi.fn(),
    });

    callbacks.onPartialTranscript("older partial", { sessionId: "old-stream" });

    expect(setPartialTranscript).not.toHaveBeenCalled();
    expect(setProgress).not.toHaveBeenCalled();
  });

  it("never places partial dictation content in renderer log metadata", () => {
    const canary = "PRIVATE-DICTATION-CANARY-7f1c";
    const callbacks = createAudioManagerCallbacks({
      activeSessionRef: { current: { sessionId: "active-stream" } },
      audioManagerRef: { current: null },
      sessionsByIdRef: { current: new Map() },
      recordingSessionIdRef: { current: "active-stream" },
      removeJob: vi.fn(),
      setIsProcessing: vi.fn(),
      setIsRecording: vi.fn(),
      setIsStreaming: vi.fn(),
      setPartialTranscript: vi.fn(),
      setProgress: vi.fn((updater) =>
        updater({ stage: "listening", generatedChars: 0, generatedWords: 0 })
      ),
      toast: vi.fn(),
      updateStage: vi.fn(),
      upsertJob: vi.fn(),
      onTranscriptionComplete: vi.fn(),
      playErrorCue: vi.fn(),
      playStopCue: vi.fn(),
    });

    callbacks.onPartialTranscript(canary, { sessionId: "active-stream" });

    const partialLogCall = traceLog.mock.calls.find(
      ([message]) => message === "Partial transcript"
    );
    expect(partialLogCall).toEqual([
      "Partial transcript",
      { sessionId: "active-stream", textLength: canary.length },
      "dictation",
    ]);
    expect(JSON.stringify(traceLog.mock.calls)).not.toContain(canary);
  });
});
