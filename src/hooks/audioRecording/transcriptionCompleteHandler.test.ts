import { describe, expect, it, vi } from "vitest";

import { createTranscriptionCompleteHandler } from "./transcriptionCompleteHandler";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const createDeliveryHarness = ({
  outputMode,
  safePaste = vi.fn(async () => true),
  writeClipboard = vi.fn(async () => ({ success: true })),
  saveTranscription = vi.fn(async () => ({ success: true, id: 321 })),
}: {
  outputMode: "insert" | "clipboard";
  safePaste?: ReturnType<typeof vi.fn>;
  writeClipboard?: ReturnType<typeof vi.fn>;
  saveTranscription?: ReturnType<typeof vi.fn>;
}) => {
  const sessionId = `cancel-${outputMode}`;
  const updateStage = vi.fn();
  const playCompletionCue = vi.fn();
  const patchTranscriptionMeta = vi.fn(async () => ({ success: true }));
  const warmupStreamingConnection = vi.fn();
  const controller = new AbortController();
  const handler = createTranscriptionCompleteHandler({
    activeSessionRef: { current: null },
    audioManagerRef: {
      current: {
        safePaste,
        saveTranscription,
        warmupStreamingConnection,
      },
    },
    jobsBySessionIdRef: {
      current: new Map([[sessionId, { sessionId, jobId: 9, startedAt: Date.now() - 100 }]]),
    },
    normalizeTriggerPayload: (payload: any) => ({
      outputMode: payload.outputMode || outputMode,
      sessionId: payload.sessionId || sessionId,
      triggeredAt: 1,
      insertionTarget: null,
    }),
    recordingSessionIdRef: { current: null },
    removeJob: vi.fn(),
    sessionsByIdRef: { current: new Map([[sessionId, { sessionId, outputMode }]]) },
    setProgress: vi.fn(),
    setTranscript: vi.fn(),
    toast: vi.fn(),
    updateStage,
    upsertJob: vi.fn(),
    playCompletionCue,
    playErrorCue: vi.fn(),
    electronAPI: { writeClipboard, patchTranscriptionMeta },
    localStorage: { getItem: () => null },
  });

  const run = () =>
    handler(
      {
        success: true,
        text: "Do not deliver after cancellation",
        rawText: "Do not deliver after cancellation",
        source: "openai",
        timings: {},
        context: { sessionId, jobId: 9, outputMode },
      },
      { signal: controller.signal }
    );

  return {
    controller,
    handler,
    patchTranscriptionMeta,
    playCompletionCue,
    run,
    saveTranscription,
    updateStage,
    warmupStreamingConnection,
    writeClipboard,
  };
};

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
    const playCompletionCue = vi.fn();

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
      playCompletionCue,
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
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Job #1 ready",
        description: "Copied to clipboard",
        size: "compact",
        variant: "success",
      })
    );
    const savePayload = (audioManagerRef.current.saveTranscription as any).mock.calls[0][0];
    expect(savePayload.meta).toMatchObject({
      sessionId: "s-1",
      outputMode: "clipboard",
      status: "success",
      provider: "openai",
      model: "gpt-4o-mini",
      textMetrics: {
        rawWords: 2,
        cleanedWords: 2,
        rawChars: 11,
        cleanedChars: 11,
      },
      timings: expect.objectContaining({ recordDurationMs: 500 }),
    });
    expect(updateStage).toHaveBeenCalledWith(
      "saving",
      expect.objectContaining({ sessionId: "s-1" })
    );
    expect(updateStage).toHaveBeenCalledWith("done", expect.objectContaining({ sessionId: "s-1" }));
    expect(playCompletionCue).toHaveBeenCalledTimes(1);
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
    const playCompletionCue = vi.fn();

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
      playCompletionCue,
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
    const savePayload = (audioManagerRef.current.saveTranscription as any).mock.calls[0][0];
    expect(savePayload.meta).toMatchObject({
      sessionId: "s-1",
      outputMode: "insert",
      status: "success",
      textMetrics: {
        rawWords: 2,
        cleanedWords: 2,
        rawChars: 9,
        cleanedChars: 9,
      },
    });
    expect(updateStage).toHaveBeenCalledWith(
      "inserting",
      expect.objectContaining({ sessionId: "s-1", jobId: 1 })
    );
    expect(updateStage).toHaveBeenCalledWith(
      "saving",
      expect.objectContaining({ sessionId: "s-1" })
    );
    expect(updateStage).toHaveBeenCalledWith("done", expect.objectContaining({ sessionId: "s-1" }));
    expect(playCompletionCue).toHaveBeenCalledTimes(1);
  });

  it("records insertion failure as a delivery issue and guarantees clipboard fallback", async () => {
    const saveTranscription = vi.fn(async () => ({ success: true, id: 99 }));
    const writeClipboard = vi.fn(async () => ({ success: true }));
    const toast = vi.fn();
    const playCompletionCue = vi.fn();
    const playErrorCue = vi.fn();
    const handler = createTranscriptionCompleteHandler({
      activeSessionRef: { current: null },
      audioManagerRef: {
        current: {
          safePaste: vi.fn(async () => false),
          saveTranscription,
          warmupStreamingConnection: vi.fn(),
        },
      },
      jobsBySessionIdRef: { current: new Map([["s-fail", { sessionId: "s-fail", jobId: 7 }]]) },
      normalizeTriggerPayload: (payload: any) => ({
        outputMode: payload.outputMode || "insert",
        sessionId: payload.sessionId || "s-fail",
        triggeredAt: 1,
      }),
      recordingSessionIdRef: { current: null },
      removeJob: vi.fn(),
      sessionsByIdRef: {
        current: new Map([["s-fail", { sessionId: "s-fail", outputMode: "insert" }]]),
      },
      setProgress: vi.fn(),
      setTranscript: vi.fn(),
      toast,
      updateStage: vi.fn(),
      upsertJob: vi.fn(),
      playCompletionCue,
      playErrorCue,
      electronAPI: { writeClipboard, patchTranscriptionMeta: vi.fn() },
      localStorage: { getItem: () => null },
    });

    await handler({
      success: true,
      text: "Keep this delivered text",
      rawText: "Keep this delivered text",
      source: "openai",
      context: { sessionId: "s-fail", outputMode: "insert" },
    });

    expect(writeClipboard).toHaveBeenCalledWith("Keep this delivered text");
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Insert failed—text kept in clipboard" })
    );
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    expect((saveTranscription as any).mock.calls[0][0].meta).toMatchObject({
      status: "delivery_issue",
      pasteSucceeded: false,
      clipboardSucceeded: true,
      delivery: { status: "clipboard_fallback", succeeded: false },
    });
    expect(playCompletionCue).not.toHaveBeenCalled();
    expect(playErrorCue).toHaveBeenCalledTimes(1);
  });

  it("records clipboard copy failure without a success toast", async () => {
    const saveTranscription = vi.fn(async () => ({ success: true, id: 100 }));
    const toast = vi.fn();
    const playCompletionCue = vi.fn();
    const playErrorCue = vi.fn();
    const handler = createTranscriptionCompleteHandler({
      activeSessionRef: { current: null },
      audioManagerRef: {
        current: {
          safePaste: vi.fn(),
          saveTranscription,
          warmupStreamingConnection: vi.fn(),
        },
      },
      jobsBySessionIdRef: { current: new Map() },
      normalizeTriggerPayload: (payload: any) => ({
        outputMode: payload.outputMode || "clipboard",
        sessionId: payload.sessionId || "s-clipboard-fail",
        triggeredAt: 1,
      }),
      recordingSessionIdRef: { current: null },
      removeJob: vi.fn(),
      sessionsByIdRef: {
        current: new Map([
          ["s-clipboard-fail", { sessionId: "s-clipboard-fail", outputMode: "clipboard" }],
        ]),
      },
      setProgress: vi.fn(),
      setTranscript: vi.fn(),
      toast,
      updateStage: vi.fn(),
      upsertJob: vi.fn(),
      playCompletionCue,
      playErrorCue,
      electronAPI: {
        writeClipboard: vi.fn(async () => {
          throw new Error("clipboard locked");
        }),
        patchTranscriptionMeta: vi.fn(),
      },
      localStorage: { getItem: () => null },
    });

    await handler({
      success: true,
      text: "Retain this text",
      rawText: "Retain this text",
      source: "openai",
      context: { sessionId: "s-clipboard-fail", outputMode: "clipboard" },
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Clipboard copy failed", variant: "destructive" })
    );
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    expect((saveTranscription as any).mock.calls[0][0].meta).toMatchObject({
      status: "delivery_issue",
      clipboardSucceeded: false,
      delivery: { status: "failed", succeeded: false },
    });
    expect(playCompletionCue).not.toHaveBeenCalled();
    expect(playErrorCue).toHaveBeenCalledTimes(1);
  });

  it("keeps the total-delivery-failure message truthful when history saving also fails", async () => {
    const saveTranscription = vi.fn(async () => ({ success: false }));
    const toast = vi.fn();
    const updateStage = vi.fn();
    const setProgress = vi.fn();
    const handler = createTranscriptionCompleteHandler({
      activeSessionRef: { current: null },
      audioManagerRef: {
        current: {
          safePaste: vi.fn(async () => false),
          saveTranscription,
          warmupStreamingConnection: vi.fn(),
        },
      },
      jobsBySessionIdRef: { current: new Map() },
      normalizeTriggerPayload: (payload: any) => ({
        outputMode: payload.outputMode || "insert",
        sessionId: payload.sessionId || "s-total-fail",
        triggeredAt: 1,
      }),
      recordingSessionIdRef: { current: null },
      removeJob: vi.fn(),
      sessionsByIdRef: {
        current: new Map([["s-total-fail", { sessionId: "s-total-fail", outputMode: "insert" }]]),
      },
      setProgress,
      setTranscript: vi.fn(),
      toast,
      updateStage,
      upsertJob: vi.fn(),
      playCompletionCue: vi.fn(),
      electronAPI: {
        writeClipboard: vi.fn(async () => {
          throw new Error("clipboard locked");
        }),
      },
      localStorage: { getItem: () => null },
    });

    await handler({
      success: true,
      text: "Keep this recoverable text",
      rawText: "Keep this recoverable text",
      source: "openai",
      context: { sessionId: "s-total-fail", outputMode: "insert" },
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "History Save Failed",
        description: expect.stringContaining("Copy Last Dictation"),
      })
    );
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining("copied to clipboard") })
    );
    expect(updateStage).toHaveBeenCalledWith(
      "done",
      expect.objectContaining({ message: "Automatic text delivery failed." })
    );
    expect(setProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Saved in") })
    );
  });

  it("stops delivery after cancellation while paste is pending", async () => {
    const paste = deferred<boolean>();
    const safePaste = vi.fn(() => paste.promise);
    const harness = createDeliveryHarness({ outputMode: "insert", safePaste });

    const pending = harness.run();
    await vi.waitFor(() => expect(safePaste).toHaveBeenCalledOnce());
    harness.controller.abort();
    paste.resolve(false);

    await expect(pending).rejects.toMatchObject({ code: "TRANSCRIPTION_CANCELLED" });
    expect(harness.writeClipboard).not.toHaveBeenCalled();
    expect(harness.saveTranscription).not.toHaveBeenCalled();
    expect(harness.playCompletionCue).not.toHaveBeenCalled();
  });

  it("stops delivery after cancellation while clipboard writing is pending", async () => {
    const clipboard = deferred<{ success: boolean }>();
    const writeClipboard = vi.fn(() => clipboard.promise);
    const harness = createDeliveryHarness({ outputMode: "clipboard", writeClipboard });

    const pending = harness.run();
    await vi.waitFor(() => expect(writeClipboard).toHaveBeenCalledOnce());
    harness.controller.abort();
    clipboard.resolve({ success: true });

    await expect(pending).rejects.toMatchObject({ code: "TRANSCRIPTION_CANCELLED" });
    expect(harness.saveTranscription).not.toHaveBeenCalled();
    expect(harness.playCompletionCue).not.toHaveBeenCalled();
  });

  it("does not patch or announce completion after cancellation while history is pending", async () => {
    const history = deferred<{ success: boolean; id: number }>();
    const saveTranscription = vi.fn(() => history.promise);
    const harness = createDeliveryHarness({ outputMode: "clipboard", saveTranscription });

    const pending = harness.run();
    await vi.waitFor(() => expect(saveTranscription).toHaveBeenCalledOnce());
    harness.controller.abort();
    history.resolve({ success: true, id: 321 });

    await expect(pending).rejects.toMatchObject({ code: "TRANSCRIPTION_CANCELLED" });
    expect(harness.patchTranscriptionMeta).not.toHaveBeenCalled();
    expect(harness.updateStage).not.toHaveBeenCalledWith("done", expect.anything());
    expect(harness.playCompletionCue).not.toHaveBeenCalled();
    expect(harness.warmupStreamingConnection).not.toHaveBeenCalled();
  });
});
