import logger from "../../utils/logger";
import { countWords } from "./textMetrics";

export const createTranscriptionCompleteHandler = (deps) => {
  const {
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
  } = deps;

  const electronAPI =
    deps.electronAPI || (typeof window !== "undefined" ? window.electronAPI : undefined);
  const storage = deps.localStorage || (typeof window !== "undefined" ? window.localStorage : undefined);

  return async (result) => {
    const audioManager = audioManagerRef.current;
    if (!audioManager) {
      return;
    }

    const contextSessionId =
      typeof result?.context?.sessionId === "string" && result.context.sessionId.trim()
        ? result.context.sessionId.trim()
        : null;

    const fallbackSession = contextSessionId
      ? normalizeTriggerPayload(result?.context || {})
      : activeSessionRef.current || normalizeTriggerPayload(result?.context || {});
    const resolvedSessionId = contextSessionId || fallbackSession.sessionId;
    const storedSession = resolvedSessionId ? sessionsByIdRef.current.get(resolvedSessionId) : null;
    const session = resolvedSessionId
      ? { ...fallbackSession, ...storedSession, sessionId: resolvedSessionId }
      : fallbackSession;

    const job = resolvedSessionId ? jobsBySessionIdRef.current.get(resolvedSessionId) : null;
    const jobId =
      typeof result?.context?.jobId === "number" && Number.isFinite(result.context.jobId)
        ? result.context.jobId
        : (job?.jobId ?? null);

    if (resolvedSessionId) {
      sessionsByIdRef.current.delete(resolvedSessionId);
    }
    if (activeSessionRef.current?.sessionId === resolvedSessionId) {
      activeSessionRef.current = null;
    }

    if (!result.success) {
      if (!recordingSessionIdRef.current) {
        updateStage("error", { message: "Transcription did not complete." });
      }
      if (resolvedSessionId) {
        upsertJob(resolvedSessionId, { status: "error" });
        setTimeout(() => removeJob(resolvedSessionId), 1500);
      }
      return;
    }

    const rawText = result.rawText || result.text;
    logger.info(
      "Dictation transcription complete",
      {
        sessionId: session.sessionId,
        jobId,
        outputMode: session.outputMode,
        triggeredAt: session.triggeredAt,
        startedAt: session.startedAt,
        releasedAt: session.releasedAt,
        hotkeyToDoneMs: session.triggeredAt ? Math.max(0, Date.now() - session.triggeredAt) : null,
        source: result.source,
        provider: job?.provider || null,
        model: job?.model || null,
        timings: result.timings || null,
        rawLength: rawText.length,
        cleanedLength: result.text.length,
      },
      "dictation"
    );

    if (typeof window !== "undefined" && window.__openwhisprLogLevel === "trace") {
      logger.trace(
        "Dictation transcript text",
        {
          sessionId: session.sessionId,
          jobId,
          source: result.source,
          rawText,
          cleanedText: result.text,
        },
        "dictation"
      );
    }

    setTranscript(result.text);

    let pasteSucceeded = false;
    let pasteMs = null;
    const isForegroundAvailable = !recordingSessionIdRef.current;

    if (session.outputMode === "insert") {
      if (isForegroundAvailable) {
        updateStage("inserting", {
          outputMode: session.outputMode,
          sessionId: session.sessionId,
          ...(jobId !== null ? { jobId } : {}),
        });
      }

      const isResultStreaming = result.source?.includes("streaming");
      const pasteStart = performance.now();
      const pasteOptions = {};
      if (isResultStreaming) {
        pasteOptions.fromStreaming = true;
      }
      if (session.insertionTarget) {
        pasteOptions.insertionTarget = session.insertionTarget;
      }
      logger.info(
        "Paste attempt",
        {
          sessionId: session.sessionId,
          jobId,
          source: result.source,
          textLength: result.text.length,
          pasteOptions,
        },
        "paste"
      );
      pasteSucceeded = await audioManager.safePaste(result.text, pasteOptions);
      pasteMs = Math.round(performance.now() - pasteStart);

      logger.info(
        "Paste timing",
        {
          pasteMs,
          source: result.source,
          textLength: result.text.length,
          outputMode: session.outputMode,
          pasteSucceeded,
        },
        "streaming"
      );
    } else {
      try {
        await electronAPI?.writeClipboard?.(result.text);
      } catch (error) {
        logger.warn("Failed to write clipboard", { error: error?.message }, "clipboard");
      }
      logger.info(
        "Copied to clipboard",
        {
          sessionId: session.sessionId,
          jobId,
          source: result.source,
          textLength: result.text.length,
        },
        "clipboard"
      );

      toast({
        title: jobId !== null ? `Copied Job #${jobId}` : "Copied to Clipboard",
        description: "Dictation finished. Paste where you want the text.",
        duration: 2500,
      });
    }

    if (isForegroundAvailable) {
      updateStage("saving", {
        outputMode: session.outputMode,
        sessionId: session.sessionId,
        ...(jobId !== null ? { jobId } : {}),
      });
    }

    const saveStart = performance.now();
    const recordDurationMs =
      typeof job?.recordedMs === "number" && job.recordedMs > 0 ? Math.round(job.recordedMs) : null;
    const baseTimings = {
      ...(result.timings || {}),
      ...(recordDurationMs !== null ? { recordDurationMs } : {}),
      pasteDurationMs: pasteMs,
    };
    const provider = job?.provider || result.source || "";
    const model = job?.model || "";

    const saveResult = await audioManager.saveTranscription({
      text: result.text,
      rawText: result.rawText || result.text,
      meta: {
        sessionId: session.sessionId,
        outputMode: session.outputMode,
        status: "success",
        source: result.source,
        provider,
        model,
        insertionTarget: session.insertionTarget || null,
        pasteSucceeded,
        timings: baseTimings,
      },
    });
    const saveSucceeded = Boolean(saveResult?.success);
    const savedId = saveResult?.id || saveResult?.transcription?.id;
    const saveMs = Math.round(performance.now() - saveStart);
    const totalDurationMs =
      typeof job?.startedAt === "number" && job.startedAt > 0 ? Math.max(0, Date.now() - job.startedAt) : null;

    if (saveSucceeded && savedId && electronAPI?.patchTranscriptionMeta) {
      try {
        await electronAPI.patchTranscriptionMeta(savedId, {
          provider,
          model,
          timings: {
            ...baseTimings,
            saveDurationMs: saveMs,
            totalDurationMs,
          },
        });
      } catch (error) {
        logger.warn(
          "Failed to patch transcription metadata",
          { error: error?.message, id: savedId },
          "transcription"
        );
      }
    }

    if (!saveSucceeded) {
      const fallbackDescription =
        session.outputMode === "insert" && pasteSucceeded
          ? "Text was inserted, but saving to history failed."
          : "Text is copied to clipboard, but saving to history failed.";
      toast({
        title: "History Save Failed",
        description: fallbackDescription,
        variant: "destructive",
        duration: 4000,
      });
    }

    logger.info(
      "History save result",
      {
        sessionId: session.sessionId,
        jobId,
        savedId: savedId || null,
        saveSucceeded,
        saveMs,
      },
      "history"
    );

    if (result.source === "openai" && storage?.getItem?.("useLocalWhisper") === "true") {
      toast({
        title: "Fallback Mode",
        description: "Local Whisper failed. Used OpenAI API instead.",
        variant: "default",
      });
    }

    if (result.source === "openwhispr" && result.limitReached) {
      electronAPI?.notifyLimitReached?.({
        wordsUsed: result.wordsUsed,
        limit: result.wordsRemaining !== undefined ? result.wordsUsed + result.wordsRemaining : 2000,
      });
    }

    if (isForegroundAvailable) {
      updateStage("done", {
        outputMode: session.outputMode,
        sessionId: session.sessionId,
        ...(jobId !== null ? { jobId } : {}),
        stageProgress: 1,
        overallProgress: 1,
        message: saveSucceeded
          ? null
          : session.outputMode === "insert" && pasteSucceeded
            ? "Inserted, but history save failed."
            : "Saved to clipboard, but history save failed.",
        provider,
        model,
        generatedChars: result.text.length,
        generatedWords: countWords(result.text),
      });

      setProgress((prev) => ({
        ...prev,
        message: saveSucceeded && saveMs > 0 ? `Saved in ${saveMs}ms` : prev.message,
      }));
    }

    if (resolvedSessionId) {
      upsertJob(resolvedSessionId, {
        status: "done",
        provider,
        model,
        outputMode: session.outputMode,
      });
      setTimeout(() => removeJob(resolvedSessionId), 1500);
    }

    audioManager.warmupStreamingConnection();
  };
};

