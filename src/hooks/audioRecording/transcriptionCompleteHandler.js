import logger from "../../utils/logger";
import { ECHO_DRAFT_CLOUD_SOURCE, normalizeEchoDraftSource } from "../../utils/branding";
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
    playCompletionCue,
    playErrorCue,
  } = deps;

  const electronAPI =
    deps.electronAPI || (typeof window !== "undefined" ? window.electronAPI : undefined);
  const storage =
    deps.localStorage || (typeof window !== "undefined" ? window.localStorage : undefined);

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
      void playErrorCue?.();
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
    const rawWords = countWords(rawText);
    const cleanedWords = countWords(result.text);
    const cleanup = result?.cleanup && typeof result.cleanup === "object" ? result.cleanup : null;
    const cleanupFallback = Boolean(cleanup?.requested && cleanup?.status === "fallback");
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
        cleanupStatus: cleanup?.status || null,
        cleanupFallbackReason: cleanup?.fallbackReason || null,
      },
      "dictation"
    );

    setTranscript(result.text);

    if (cleanupFallback) {
      toast({
        title: "Original transcript preserved",
        description:
          cleanup?.fallbackReason === "fidelity_rejected"
            ? "AI cleanup changed too much, so EchoDraft kept every original word."
            : "AI cleanup was unavailable, so EchoDraft used the original transcript.",
        variant: "default",
        duration: 5000,
      });
    }

    let pasteSucceeded = false;
    let clipboardSucceeded = false;
    let deliveryStatus = "pending";
    let deliveryError = null;
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
      if (pasteSucceeded) {
        deliveryStatus = "inserted";
      } else {
        try {
          if (typeof electronAPI?.writeClipboard !== "function") {
            throw new Error("Clipboard API unavailable");
          }
          const clipboardResult = await electronAPI.writeClipboard(result.text);
          if (clipboardResult?.success === false) {
            throw new Error(clipboardResult.error || "Clipboard write failed");
          }
          clipboardSucceeded = true;
          deliveryStatus = "clipboard_fallback";
          deliveryError = "Automatic insertion failed; text was kept in the clipboard.";
          toast({
            title: "Insert failed—text kept in clipboard",
            description: "Paste it manually with Ctrl+V.",
            variant: "default",
            duration: 5000,
          });
        } catch (error) {
          deliveryStatus = "failed";
          deliveryError = `Automatic insertion and clipboard copy failed: ${error?.message || String(error)}`;
          logger.warn(
            "Failed to retain text in clipboard after insertion failure",
            { error: error?.message || String(error) },
            "clipboard"
          );
          toast({
            title: "Text delivery failed",
            description: "EchoDraft kept the text on screen and will try to save it in history.",
            variant: "destructive",
            duration: 6000,
          });
        }
      }

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
        if (typeof electronAPI?.writeClipboard !== "function") {
          throw new Error("Clipboard API unavailable");
        }
        const clipboardResult = await electronAPI.writeClipboard(result.text);
        if (clipboardResult?.success === false) {
          throw new Error(clipboardResult.error || "Clipboard write failed");
        }
        clipboardSucceeded = true;
        deliveryStatus = "clipboard";
      } catch (error) {
        deliveryStatus = "failed";
        deliveryError = `Clipboard copy failed: ${error?.message || String(error)}`;
        logger.warn(
          "Failed to write clipboard",
          { error: error?.message || String(error) },
          "clipboard"
        );
      }
      logger.info(
        clipboardSucceeded ? "Copied to clipboard" : "Clipboard delivery failed",
        {
          sessionId: session.sessionId,
          jobId,
          source: result.source,
          textLength: result.text.length,
        },
        "clipboard"
      );

      if (clipboardSucceeded) {
        toast({
          title: jobId !== null ? `Job #${jobId} ready` : "Ready to paste",
          description: "Copied to clipboard",
          duration: 1800,
          size: "compact",
          variant: "success",
        });
      } else {
        toast({
          title: "Clipboard copy failed",
          description: "EchoDraft kept the text on screen and will try to save it in history.",
          duration: 6000,
          variant: "destructive",
        });
      }
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
    const stopReason =
      typeof job?.stopReason === "string" && job.stopReason.trim()
        ? job.stopReason.trim()
        : typeof result?.timings?.stopReason === "string" && result.timings.stopReason.trim()
          ? result.timings.stopReason.trim()
          : null;
    const stopSource =
      typeof job?.stopSource === "string" && job.stopSource.trim()
        ? job.stopSource.trim()
        : typeof result?.timings?.stopSource === "string" && result.timings.stopSource.trim()
          ? result.timings.stopSource.trim()
          : null;
    const baseTimings = {
      ...(result.timings || {}),
      ...(recordDurationMs !== null ? { recordDurationMs } : {}),
      pasteDurationMs: pasteMs,
      ...(stopReason ? { stopReason } : {}),
      ...(stopSource ? { stopSource } : {}),
    };
    const provider = job?.provider || result.source || "";
    const model = job?.model || "";
    const deliverySucceeded = deliveryStatus === "inserted" || deliveryStatus === "clipboard";
    const historyStatus = deliverySucceeded ? "success" : "delivery_issue";

    const saveResult = await audioManager.saveTranscription({
      text: result.text,
      rawText: result.rawText || result.text,
      meta: {
        sessionId: session.sessionId,
        outputMode: session.outputMode,
        status: historyStatus,
        source: result.source,
        provider,
        model,
        insertionTarget: session.insertionTarget || null,
        pasteSucceeded,
        clipboardSucceeded,
        delivery: {
          status: deliveryStatus,
          succeeded: deliverySucceeded,
          ...(deliveryError ? { error: deliveryError } : {}),
        },
        ...(deliveryError ? { error: deliveryError } : {}),
        ...(stopReason ? { stopReason } : {}),
        ...(stopSource ? { stopSource } : {}),
        textMetrics: {
          rawWords,
          cleanedWords,
          rawChars: rawText.length,
          cleanedChars: result.text.length,
        },
        ...(cleanup ? { cleanup } : {}),
        timings: baseTimings,
      },
    });
    const saveSucceeded = Boolean(saveResult?.success);
    const savedId = saveResult?.id || saveResult?.transcription?.id;
    const saveMs = Math.round(performance.now() - saveStart);
    const totalDurationMs =
      typeof job?.startedAt === "number" && job.startedAt > 0
        ? Math.max(0, Date.now() - job.startedAt)
        : null;

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
        deliveryStatus === "inserted"
          ? "Text was inserted, but saving to history failed."
          : deliveryStatus === "clipboard" || deliveryStatus === "clipboard_fallback"
            ? "Text is in the clipboard, but saving to history failed."
            : "Clipboard delivery and history saving both failed. Use Copy Last Dictation in the EchoDraft tray menu to recover the text.";
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

    if (
      normalizeEchoDraftSource(result.source) === ECHO_DRAFT_CLOUD_SOURCE &&
      result.limitReached
    ) {
      electronAPI?.notifyLimitReached?.({
        wordsUsed: result.wordsUsed,
        limit:
          result.wordsRemaining !== undefined ? result.wordsUsed + result.wordsRemaining : 2000,
      });
    }

    if (isForegroundAvailable) {
      updateStage("done", {
        outputMode: session.outputMode,
        sessionId: session.sessionId,
        ...(jobId !== null ? { jobId } : {}),
        stageProgress: 1,
        overallProgress: 1,
        message:
          deliveryStatus === "clipboard_fallback"
            ? "Insert failed; text kept in clipboard."
            : deliveryStatus === "failed"
              ? "Automatic text delivery failed."
              : saveSucceeded
                ? cleanupFallback
                  ? "Original transcript used; cleanup was not applied."
                  : null
                : session.outputMode === "insert" && pasteSucceeded
                  ? "Inserted, but history save failed."
                  : "Saved to clipboard, but history save failed.",
        provider,
        model,
        generatedChars: result.text.length,
        generatedWords: countWords(result.text),
      });

      if (deliverySucceeded && saveSucceeded && !cleanupFallback && saveMs > 0) {
        setProgress((prev) => ({
          ...prev,
          message: `Saved in ${saveMs}ms`,
        }));
      }
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

    if (deliverySucceeded) {
      void playCompletionCue?.();
    } else {
      void playErrorCue?.();
    }
    audioManager.warmupStreamingConnection();
  };
};
