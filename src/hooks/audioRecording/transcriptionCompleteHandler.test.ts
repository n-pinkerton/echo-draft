import { describe, expect, it, vi } from "vitest";

import {
  createTranscriptionCompleteHandler,
  getCleanupFallbackFeedback,
} from "./transcriptionCompleteHandler";

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
  safePasteWithResult,
  writeClipboard = vi.fn(async () => ({ success: true })),
  saveTranscription = vi.fn(async () => ({ success: true, id: 321 })),
  recordingSessionId = null,
}: {
  outputMode: "insert" | "clipboard";
  safePaste?: ReturnType<typeof vi.fn>;
  safePasteWithResult?: ReturnType<typeof vi.fn>;
  writeClipboard?: ReturnType<typeof vi.fn>;
  saveTranscription?: ReturnType<typeof vi.fn>;
  recordingSessionId?: string | null;
}) => {
  const sessionId = `cancel-${outputMode}`;
  const updateStage = vi.fn();
  const playCompletionCue = vi.fn();
  const playErrorCue = vi.fn();
  const playWarningCue = vi.fn();
  const toast = vi.fn();
  const patchTranscriptionMeta = vi.fn(async () => ({ success: true }));
  const warmupStreamingConnection = vi.fn();
  const controller = new AbortController();
  const deliveryCommitCountRef = { current: 0 };
  const recordingSessionIdRef = { current: recordingSessionId };
  const handler = createTranscriptionCompleteHandler({
    activeSessionRef: { current: null },
    audioManagerRef: {
      current: {
        safePaste,
        ...(safePasteWithResult ? { safePasteWithResult } : {}),
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
    recordingSessionIdRef,
    removeJob: vi.fn(),
    sessionsByIdRef: { current: new Map([[sessionId, { sessionId, outputMode }]]) },
    setProgress: vi.fn(),
    setTranscript: vi.fn(),
    toast,
    updateStage,
    upsertJob: vi.fn(),
    deliveryCommitCountRef,
    playCompletionCue,
    playErrorCue,
    playWarningCue,
    electronAPI: { writeClipboard, patchTranscriptionMeta },
    localStorage: { getItem: () => null },
  });

  const run = (overrides: Record<string, unknown> = {}) =>
    handler(
      {
        success: true,
        text: "Committed delivery text",
        rawText: "Committed delivery text",
        source: "openai",
        timings: {},
        context: { sessionId, jobId: 9, outputMode },
        ...overrides,
      },
      { signal: controller.signal }
    );

  return {
    controller,
    deliveryCommitCountRef,
    handler,
    patchTranscriptionMeta,
    playCompletionCue,
    playErrorCue,
    playWarningCue,
    recordingSessionIdRef,
    run,
    safePaste,
    saveTranscription,
    toast,
    updateStage,
    warmupStreamingConnection,
    writeClipboard,
  };
};

describe("createTranscriptionCompleteHandler", () => {
  it("routes a mobile result to To Do without touching clipboard or History", async () => {
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    const requestId = "5f8d2d0e-3792-48cc-b8df-bf651c365a17";
    const completeMobileInboxItem = vi.fn(async () => ({ success: true }));
    const saveTranscription = vi.fn();
    const safePaste = vi.fn();
    const writeClipboard = vi.fn();
    const removeJob = vi.fn();
    const handler = createTranscriptionCompleteHandler({
      activeSessionRef: { current: null },
      audioManagerRef: {
        current: { saveTranscription, safePaste, warmupStreamingConnection: vi.fn() },
      },
      jobsBySessionIdRef: {
        current: new Map([
          [sessionId, { sessionId, jobId: 3, provider: "openai", model: "gpt-4o-transcribe" }],
        ]),
      },
      normalizeTriggerPayload: (payload: any) => payload,
      recordingSessionIdRef: { current: null },
      removeJob,
      sessionsByIdRef: { current: new Map() },
      setProgress: vi.fn(),
      setTranscript: vi.fn(),
      toast: vi.fn(),
      updateStage: vi.fn(),
      upsertJob: vi.fn(),
      electronAPI: { completeMobileInboxItem, writeClipboard },
    });

    await handler({
      success: true,
      title: "Call Taylor",
      text: "Call Taylor tomorrow.",
      rawText: "call taylor tomorrow",
      source: "openai",
      cleanup: { requested: true, status: "applied" },
      context: {
        sessionId,
        jobId: 3,
        outputMode: "mobile-todo",
        mobileInboxRequestId: requestId,
      },
    });

    expect(completeMobileInboxItem).toHaveBeenCalledWith(
      requestId,
      expect.objectContaining({
        success: true,
        title: "Call Taylor",
        text: "Call Taylor tomorrow.",
        provider: "openai",
        model: "gpt-4o-transcribe",
      })
    );
    expect(saveTranscription).not.toHaveBeenCalled();
    expect(safePaste).not.toHaveBeenCalled();
    expect(writeClipboard).not.toHaveBeenCalled();
    expect(removeJob).toHaveBeenCalledWith(sessionId);
  });

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
      title: "Greeting follow-up",
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
      title: "Greeting follow-up",
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
            insertionTarget: {
              capability: "opaque-target",
              sessionId: "s-1",
              capturedAt: 1,
            },
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
      expect.objectContaining({
        fromStreaming: true,
        insertionTarget: {
          capability: "opaque-target",
          sessionId: "s-1",
          capturedAt: 1,
        },
        sessionId: "s-1",
      })
    );
    expect(audioManagerRef.current.saveTranscription).toHaveBeenCalled();
    const savePayload = (audioManagerRef.current.saveTranscription as any).mock.calls[0][0];
    expect(savePayload.meta).not.toHaveProperty("insertionTarget");
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
    const playWarningCue = vi.fn();
    const updateStage = vi.fn();
    const setProgress = vi.fn();
    const handler = createTranscriptionCompleteHandler({
      activeSessionRef: { current: null },
      audioManagerRef: {
        current: {
          safePaste: vi.fn(async () => false),
          safePasteWithResult: vi.fn(async () => ({
            success: false,
            errorCode: "WINDOWS_SECURE_PASTE_SEND_INPUT_FAILED",
          })),
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
      setProgress,
      setTranscript: vi.fn(),
      toast,
      updateStage,
      upsertJob: vi.fn(),
      playCompletionCue,
      playErrorCue,
      playWarningCue,
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
      delivery: { status: "clipboard_fallback", succeeded: true },
    });
    expect((saveTranscription as any).mock.calls[0][0].meta.delivery.reasonCode).toBe(
      "WINDOWS_SECURE_PASTE_SEND_INPUT_FAILED"
    );
    expect(updateStage).toHaveBeenCalledWith(
      "warning",
      expect.objectContaining({ message: "Insert failed; text kept in clipboard." })
    );
    expect(playCompletionCue).not.toHaveBeenCalled();
    expect(playErrorCue).not.toHaveBeenCalled();
    expect(playWarningCue).toHaveBeenCalledTimes(1);
    expect(setProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Saved in") })
    );
  });

  it("leaves an unsupported custom-format clipboard untouched and saves recovery text", async () => {
    const safePasteWithResult = vi.fn(async () => ({
      success: false,
      errorCode: "WINDOWS_CLIPBOARD_PRESERVATION_UNSUPPORTED",
    }));
    const harness = createDeliveryHarness({ outputMode: "insert", safePasteWithResult });

    await harness.run();

    expect(harness.writeClipboard).not.toHaveBeenCalled();
    expect(harness.saveTranscription).toHaveBeenCalledOnce();
    expect((harness.saveTranscription as any).mock.calls[0][0].meta).toMatchObject({
      status: "delivery_issue",
      pasteSucceeded: false,
      clipboardSucceeded: false,
      delivery: {
        status: "clipboard_protected",
        succeeded: false,
        reasonCode: "WINDOWS_CLIPBOARD_PRESERVATION_UNSUPPORTED",
      },
    });
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Insert paused—clipboard protected" })
    );
    expect(harness.updateStage).toHaveBeenCalledWith(
      "warning",
      expect.objectContaining({
        stageLabel: "Insert paused",
        message: "Insert paused; existing clipboard left unchanged.",
      })
    );
    expect(harness.playWarningCue).toHaveBeenCalledOnce();
  });

  it("preserves newer clipboard content after a delayed insertion failure", async () => {
    const safePasteWithResult = vi.fn(async () => ({
      success: false,
      errorCode: "WINDOWS_SECURE_PASTE_FOREGROUND_CHANGED_BEFORE_INJECTION",
      clipboardWriteCommitted: true,
      clipboardRetained: false,
    }));
    const harness = createDeliveryHarness({ outputMode: "insert", safePasteWithResult });

    await harness.run();

    expect(harness.writeClipboard).not.toHaveBeenCalled();
    expect((harness.saveTranscription as any).mock.calls[0][0].meta).toMatchObject({
      status: "delivery_issue",
      pasteSucceeded: false,
      clipboardSucceeded: false,
      delivery: {
        status: "clipboard_changed",
        succeeded: false,
        reasonCode: "WINDOWS_SECURE_PASTE_FOREGROUND_CHANGED_BEFORE_INJECTION",
      },
    });
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Insert failed—newer clipboard kept" })
    );
    expect(harness.updateStage).toHaveBeenCalledWith(
      "warning",
      expect.objectContaining({
        stageLabel: "Insert failed",
        message: "Insert failed; newer clipboard contents preserved.",
      })
    );
    expect(harness.playWarningCue).toHaveBeenCalledOnce();
  });

  it("does not rewrite a transcript that the failed paste already retained", async () => {
    const safePasteWithResult = vi.fn(async () => ({
      success: false,
      errorCode: "WINDOWS_SECURE_PASTE_SEND_INPUT_FAILED",
      clipboardWriteCommitted: true,
      clipboardRetained: true,
    }));
    const harness = createDeliveryHarness({ outputMode: "insert", safePasteWithResult });

    await harness.run();

    expect(harness.writeClipboard).not.toHaveBeenCalled();
    expect((harness.saveTranscription as any).mock.calls[0][0].meta.delivery).toMatchObject({
      status: "clipboard_fallback",
      succeeded: true,
    });
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Insert failed—text kept in clipboard" })
    );
  });

  it("warns without suggesting another paste when partial SendInput may have inserted text", async () => {
    const safePasteWithResult = vi.fn(async () => ({
      success: false,
      errorCode: "WINDOWS_SECURE_PASTE_PARTIAL_SEND_INPUT_RECOVERED",
      clipboardWriteCommitted: true,
      clipboardRetained: true,
      insertionMayHaveOccurred: true,
    }));
    const harness = createDeliveryHarness({ outputMode: "insert", safePasteWithResult });

    await harness.run();

    expect(harness.writeClipboard).not.toHaveBeenCalled();
    expect((harness.saveTranscription as any).mock.calls[0][0].meta).toMatchObject({
      status: "delivery_issue",
      pasteSucceeded: false,
      clipboardSucceeded: true,
      delivery: {
        status: "insert_uncertain",
        succeeded: false,
        reasonCode: "WINDOWS_SECURE_PASTE_PARTIAL_SEND_INPUT_RECOVERED",
      },
    });
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Insert may have completed",
        description: expect.stringContaining("Check the target before pasting again"),
      })
    );
    expect(harness.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/paste it manually/i) })
    );
    expect(harness.updateStage).toHaveBeenCalledWith(
      "warning",
      expect.objectContaining({
        message: "Insert may have completed; check before pasting again.",
      })
    );
    expect(harness.playWarningCue).toHaveBeenCalledOnce();
  });

  it("withholds automatic insertion and preserves recovery text when a transcript may be incomplete", async () => {
    const harness = createDeliveryHarness({ outputMode: "insert" });

    await harness.run({ suspectedIncomplete: true });

    expect(harness.safePaste).not.toHaveBeenCalled();
    expect(harness.writeClipboard).not.toHaveBeenCalled();
    expect((harness.saveTranscription as any).mock.calls[0][0].meta).toMatchObject({
      status: "delivery_issue",
      pasteSucceeded: false,
      clipboardSucceeded: false,
      delivery: {
        status: "transcription_incomplete",
        succeeded: false,
        reasonCode: "TRANSCRIPTION_RECOVERY_FAILED",
      },
    });
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Transcript may be incomplete",
        description: expect.stringContaining("did not insert it or replace your clipboard"),
      })
    );
    expect(harness.updateStage).toHaveBeenCalledWith(
      "warning",
      expect.objectContaining({
        stageLabel: "Transcript needs review",
        message: "Transcript may be incomplete; automatic insertion was skipped.",
      })
    );
    expect(harness.playWarningCue).toHaveBeenCalledOnce();
    expect(harness.playCompletionCue).not.toHaveBeenCalled();
  });

  it.each(["WINDOWS_CLIPBOARD_RESTORE_PENDING", "WINDOWS_CLIPBOARD_PRESERVATION_UNSUPPORTED"])(
    "does not touch a protected insert clipboard when truncation recovery fails: %s",
    async (code) => {
      const safePasteWithResult = vi.fn(async () => ({ success: false, errorCode: code }));
      const writeClipboard = vi.fn(async () => ({ success: false }));
      const harness = createDeliveryHarness({
        outputMode: "insert",
        safePasteWithResult,
        writeClipboard,
      });

      await harness.run({ suspectedIncomplete: true });

      expect(safePasteWithResult).not.toHaveBeenCalled();
      expect(writeClipboard).not.toHaveBeenCalled();
      expect(harness.saveTranscription).toHaveBeenCalledOnce();
      expect((harness.saveTranscription as any).mock.calls[0][0].meta.delivery).toMatchObject({
        status: "transcription_incomplete",
        succeeded: false,
      });
    }
  );

  it("records successful insertion with a clipboard-restoration warning without copying again", async () => {
    const safePasteWithResult = vi.fn(async () => ({
      success: true,
      inserted: true,
      clipboardRestored: false,
      warningCode: "WINDOWS_CLIPBOARD_RESTORE_FAILED",
    }));
    const harness = createDeliveryHarness({ outputMode: "insert", safePasteWithResult });

    await harness.run();

    expect(harness.writeClipboard).not.toHaveBeenCalled();
    expect(harness.saveTranscription).toHaveBeenCalledOnce();
    expect((harness.saveTranscription as any).mock.calls[0][0].meta).toMatchObject({
      status: "delivery_issue",
      pasteSucceeded: true,
      clipboardSucceeded: false,
      delivery: {
        status: "inserted_clipboard_warning",
        succeeded: true,
        reasonCode: "WINDOWS_CLIPBOARD_RESTORE_FAILED",
      },
    });
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Text inserted—clipboard recovery pending",
        description: expect.stringContaining("Do not paste again"),
      })
    );
    expect(harness.updateStage).toHaveBeenCalledWith(
      "warning",
      expect.objectContaining({ message: "Inserted; previous clipboard recovery is pending." })
    );
    expect(harness.playCompletionCue).not.toHaveBeenCalled();
    expect(harness.playWarningCue).toHaveBeenCalledOnce();
  });

  it("does not overwrite the clipboard while a prior restoration is pending", async () => {
    const safePasteWithResult = vi.fn(async () => ({
      success: false,
      errorCode: "WINDOWS_CLIPBOARD_RESTORE_PENDING",
    }));
    const harness = createDeliveryHarness({ outputMode: "insert", safePasteWithResult });

    await harness.run();

    expect(harness.writeClipboard).not.toHaveBeenCalled();
    expect((harness.saveTranscription as any).mock.calls[0][0].meta.delivery).toMatchObject({
      status: "clipboard_protected",
      succeeded: false,
      reasonCode: "WINDOWS_CLIPBOARD_RESTORE_PENDING",
    });
    expect(harness.updateStage).toHaveBeenCalledWith(
      "warning",
      expect.objectContaining({
        message: "Insert paused; previous clipboard recovery is still pending.",
      })
    );
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
      playCompletionCue,
      playErrorCue,
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
      "error",
      expect.objectContaining({ message: "Automatic text delivery failed." })
    );
    expect(playCompletionCue).not.toHaveBeenCalled();
    expect(playErrorCue).toHaveBeenCalledTimes(1);
    expect(setProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("Saved in") })
    );
  });

  it("cancels before the delivery commit without starting any side effects", async () => {
    const harness = createDeliveryHarness({ outputMode: "insert" });
    harness.controller.abort();

    await expect(harness.run()).rejects.toMatchObject({ code: "TRANSCRIPTION_CANCELLED" });
    expect(harness.safePaste).not.toHaveBeenCalled();
    expect(harness.writeClipboard).not.toHaveBeenCalled();
    expect(harness.saveTranscription).not.toHaveBeenCalled();
    expect(harness.deliveryCommitCountRef.current).toBe(0);
  });

  it("finishes a committed insertion when cancellation arrives while paste is pending", async () => {
    const paste = deferred<boolean>();
    const safePaste = vi.fn(() => paste.promise);
    const harness = createDeliveryHarness({ outputMode: "insert", safePaste });

    const pending = harness.run();
    await vi.waitFor(() => expect(safePaste).toHaveBeenCalledOnce());
    expect(harness.deliveryCommitCountRef.current).toBe(1);
    harness.controller.abort();
    paste.resolve(true);

    await expect(pending).resolves.toBeUndefined();
    expect(harness.writeClipboard).not.toHaveBeenCalled();
    expect(harness.saveTranscription).toHaveBeenCalledOnce();
    expect(harness.updateStage).toHaveBeenCalledWith("done", expect.anything());
    expect(harness.playCompletionCue).toHaveBeenCalledOnce();
    expect(harness.deliveryCommitCountRef.current).toBe(0);
  });

  it("finishes a committed copy when cancellation arrives while clipboard writing is pending", async () => {
    const clipboard = deferred<{ success: boolean }>();
    const writeClipboard = vi.fn(() => clipboard.promise);
    const harness = createDeliveryHarness({ outputMode: "clipboard", writeClipboard });

    const pending = harness.run();
    await vi.waitFor(() => expect(writeClipboard).toHaveBeenCalledOnce());
    expect(harness.deliveryCommitCountRef.current).toBe(1);
    harness.controller.abort();
    clipboard.resolve({ success: true });

    await expect(pending).resolves.toBeUndefined();
    expect(harness.saveTranscription).toHaveBeenCalledOnce();
    expect(harness.updateStage).toHaveBeenCalledWith("done", expect.anything());
    expect(harness.playCompletionCue).toHaveBeenCalledOnce();
    expect(harness.deliveryCommitCountRef.current).toBe(0);
  });

  it("finishes committed history work when cancellation arrives while saving is pending", async () => {
    const history = deferred<{ success: boolean; id: number }>();
    const saveTranscription = vi.fn(() => history.promise);
    const harness = createDeliveryHarness({ outputMode: "clipboard", saveTranscription });

    const pending = harness.run();
    await vi.waitFor(() => expect(saveTranscription).toHaveBeenCalledOnce());
    expect(harness.deliveryCommitCountRef.current).toBe(1);
    harness.controller.abort();
    history.resolve({ success: true, id: 321 });

    await expect(pending).resolves.toBeUndefined();
    expect(harness.patchTranscriptionMeta).toHaveBeenCalledOnce();
    expect(harness.updateStage).toHaveBeenCalledWith("done", expect.anything());
    expect(harness.playCompletionCue).toHaveBeenCalledOnce();
    expect(harness.warmupStreamingConnection).toHaveBeenCalledOnce();
    expect(harness.deliveryCommitCountRef.current).toBe(0);
  });

  it("finishes successful delivery with a cleanup-fallback warning and warning cue", async () => {
    const harness = createDeliveryHarness({ outputMode: "clipboard" });

    await harness.run({
      cleanup: {
        requested: true,
        status: "fallback",
        fallbackReason: "fidelity_rejected",
      },
    });

    expect(harness.writeClipboard).toHaveBeenCalledWith("Committed delivery text");
    expect(harness.updateStage).toHaveBeenLastCalledWith(
      "warning",
      expect.objectContaining({
        message: "Original transcript used; cleanup did not pass preservation checks.",
      })
    );
    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Original transcript preserved",
        description: expect.stringContaining("kept every original word"),
      })
    );
    expect(harness.playWarningCue).toHaveBeenCalledOnce();
    expect(harness.playCompletionCue).not.toHaveBeenCalled();
    expect(harness.playErrorCue).not.toHaveBeenCalled();
  });

  it("does not show a cleanup-failure warning when one-word retry drift was discarded", async () => {
    const harness = createDeliveryHarness({ outputMode: "clipboard" });

    await harness.run({
      cleanup: {
        requested: true,
        attempted: true,
        applied: false,
        status: "unchanged",
        fallbackReason: null,
        retryCount: 1,
        retryDriftRecovered: true,
        metrics: { retryDriftRecovered: true },
      },
    });

    expect(harness.updateStage).toHaveBeenLastCalledWith("done", expect.anything());
    expect(harness.playCompletionCue).toHaveBeenCalledOnce();
    expect(harness.playWarningCue).not.toHaveBeenCalled();
    expect(harness.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Original transcript preserved" })
    );
  });

  it("does not claim a dictionary spelling when the authoritative cleanup flag is false", async () => {
    const harness = createDeliveryHarness({ outputMode: "clipboard" });

    await harness.run({
      cleanup: {
        requested: true,
        status: "fallback",
        fallbackReason: "provider_error",
        preferredSpellingApplied: false,
        metrics: { preferredSpellingCorrectionCount: 3 },
      },
    });

    expect(harness.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Original transcript preserved",
        description: expect.stringContaining("kept every original word"),
      })
    );
    expect(harness.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/dictionary spelling/i) })
    );
  });

  it("keeps terminal cues silent when an earlier job finishes behind a live recording", async () => {
    const harness = createDeliveryHarness({
      outputMode: "clipboard",
      recordingSessionId: "new-live-recording",
    });

    await harness.run();

    expect(harness.writeClipboard).toHaveBeenCalledOnce();
    expect(harness.saveTranscription).toHaveBeenCalledOnce();
    expect(harness.playCompletionCue).not.toHaveBeenCalled();
    expect(harness.playWarningCue).not.toHaveBeenCalled();
    expect(harness.playErrorCue).not.toHaveBeenCalled();
  });

  it("rechecks foreground ownership after a delayed successful save", async () => {
    const history = deferred<{ success: boolean; id: number }>();
    const harness = createDeliveryHarness({
      outputMode: "clipboard",
      saveTranscription: vi.fn(() => history.promise),
    });

    const pending = harness.run();
    await vi.waitFor(() => expect(harness.saveTranscription).toHaveBeenCalledOnce());
    harness.recordingSessionIdRef.current = "new-live-recording";
    history.resolve({ success: true, id: 321 });
    await pending;

    expect(
      harness.updateStage.mock.calls.filter(([stage]) =>
        ["done", "warning", "error"].includes(stage)
      )
    ).toHaveLength(0);
    expect(harness.playCompletionCue).not.toHaveBeenCalled();
    expect(harness.playWarningCue).not.toHaveBeenCalled();
    expect(harness.playErrorCue).not.toHaveBeenCalled();
  });

  it("rechecks foreground ownership after a delayed save warning", async () => {
    const history = deferred<{ success: boolean }>();
    const harness = createDeliveryHarness({
      outputMode: "clipboard",
      saveTranscription: vi.fn(() => history.promise),
    });

    const pending = harness.run();
    await vi.waitFor(() => expect(harness.saveTranscription).toHaveBeenCalledOnce());
    harness.recordingSessionIdRef.current = "new-live-recording";
    history.resolve({ success: false });
    await pending;

    expect(
      harness.updateStage.mock.calls.filter(([stage]) =>
        ["done", "warning", "error"].includes(stage)
      )
    ).toHaveLength(0);
    expect(harness.playCompletionCue).not.toHaveBeenCalled();
    expect(harness.playWarningCue).not.toHaveBeenCalled();
    expect(harness.playErrorCue).not.toHaveBeenCalled();
  });

  it("rechecks foreground ownership after a delayed delivery error", async () => {
    const paste = deferred<boolean>();
    const harness = createDeliveryHarness({
      outputMode: "insert",
      safePaste: vi.fn(() => paste.promise),
      writeClipboard: vi.fn(async () => ({ success: false, error: "clipboard unavailable" })),
    });

    const pending = harness.run();
    await vi.waitFor(() => expect(harness.safePaste).toHaveBeenCalledOnce());
    harness.recordingSessionIdRef.current = "new-live-recording";
    paste.resolve(false);
    await pending;

    expect(
      harness.updateStage.mock.calls.filter(([stage]) =>
        ["done", "warning", "error"].includes(stage)
      )
    ).toHaveLength(0);
    expect(harness.playCompletionCue).not.toHaveBeenCalled();
    expect(harness.playWarningCue).not.toHaveBeenCalled();
    expect(harness.playErrorCue).not.toHaveBeenCalled();
  });

  it("keeps an unsuccessful older result silent behind a live recording", async () => {
    const harness = createDeliveryHarness({
      outputMode: "clipboard",
      recordingSessionId: "new-live-recording",
    });

    await harness.run({ success: false });

    expect(harness.updateStage).not.toHaveBeenCalledWith("error", expect.anything());
    expect(harness.playErrorCue).not.toHaveBeenCalled();
  });
});

describe("getCleanupFallbackFeedback", () => {
  it.each([
    ["fidelity_rejected", "failed preservation checks", "did not pass preservation checks"],
    ["not_configured", "not configured", "needs setup"],
    ["unavailable", "was unavailable", "was unavailable"],
    ["provider_error", "request failed", "request failed"],
  ])("explains %s without conflating fallback causes", (reason, description, stageMessage) => {
    expect(getCleanupFallbackFeedback(reason)).toMatchObject({
      description: expect.stringContaining(description),
      stageMessage: expect.stringContaining(stageMessage),
    });
  });

  it("mentions two attempts only when the retry count records a second pass", () => {
    expect(getCleanupFallbackFeedback("fidelity_rejected", 0)).toMatchObject({
      description: expect.not.stringContaining("Both"),
      stageMessage: expect.not.stringContaining("neither"),
    });
    expect(getCleanupFallbackFeedback("fidelity_rejected", 1)).toMatchObject({
      description: expect.stringContaining("Both"),
      stageMessage: expect.stringContaining("neither"),
    });
  });

  it("truthfully describes a verified dictionary spelling retained during fallback", () => {
    expect(getCleanupFallbackFeedback("fidelity_rejected", 1, true)).toMatchObject({
      title: "Transcript preserved with dictionary spelling",
      description: expect.stringContaining("a verified dictionary spelling"),
      stageMessage: expect.stringContaining("verified dictionary spelling applied"),
    });
    expect(getCleanupFallbackFeedback("fidelity_rejected", 1, true).description).toContain(
      "otherwise kept the original transcript"
    );
  });
});
