import logger from "../../utils/logger";
import { ECHO_DRAFT_CLOUD_SOURCE, normalizeEchoDraftSource } from "../../utils/branding";
import { throwIfTranscriptionCancelled } from "../../helpers/audio/pipeline/cancellation";
import { countWords } from "./textMetrics";

const CLIPBOARD_PROTECTION_FAILURE_CODES = new Set([
  "WINDOWS_CLIPBOARD_PRESERVATION_UNSUPPORTED",
  "WINDOWS_CLIPBOARD_RESTORE_PENDING",
]);

export const getCleanupFallbackFeedback = (fallbackReason, retryCount = 0) => {
  if (fallbackReason === "fidelity_rejected") {
    const retryAttempted = Number(retryCount) > 0;
    return {
      description: retryAttempted
        ? "Both AI cleanup attempts failed preservation checks, so EchoDraft kept every original word."
        : "AI cleanup failed preservation checks, so EchoDraft kept every original word.",
      stageMessage: retryAttempted
        ? "Original transcript used; neither cleanup attempt passed preservation checks."
        : "Original transcript used; cleanup did not pass preservation checks.",
    };
  }
  if (fallbackReason === "not_configured") {
    return {
      description: "AI cleanup is not configured, so EchoDraft used the original transcript.",
      stageMessage: "Original transcript used; cleanup needs setup.",
    };
  }
  if (fallbackReason === "unavailable") {
    return {
      description: "AI cleanup was unavailable, so EchoDraft used the original transcript.",
      stageMessage: "Original transcript used; cleanup was unavailable.",
    };
  }
  return {
    description: "The AI cleanup request failed, so EchoDraft used the original transcript.",
    stageMessage: "Original transcript used; cleanup request failed.",
  };
};

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
    playWarningCue,
  } = deps;
  const deliveryCommitCountRef = deps.deliveryCommitCountRef || { current: 0 };

  const electronAPI =
    deps.electronAPI || (typeof window !== "undefined" ? window.electronAPI : undefined);
  const storage =
    deps.localStorage || (typeof window !== "undefined" ? window.localStorage : undefined);

  return async (result, runtime = {}) => {
    const audioManager = audioManagerRef.current;
    if (!audioManager) {
      return;
    }
    const signal = runtime?.signal || audioManager.activeProcessingAbortController?.signal || null;
    let deliveryCommitted = false;
    const assertDeliveryActive = () => {
      if (!deliveryCommitted) throwIfTranscriptionCancelled(signal);
    };
    assertDeliveryActive();

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
      assertDeliveryActive();
      if (!recordingSessionIdRef.current) {
        void playErrorCue?.();
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
    const cleanupFallbackFeedback = cleanupFallback
      ? getCleanupFallbackFeedback(cleanup?.fallbackReason, cleanup?.retryCount)
      : null;
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

    assertDeliveryActive();
    deliveryCommitted = true;
    deliveryCommitCountRef.current += 1;
    if (!recordingSessionIdRef.current) {
      updateStage("delivering", {
        outputMode: session.outputMode,
        sessionId: session.sessionId,
        ...(jobId !== null ? { jobId } : {}),
        canCancel: false,
      });
    }

    try {
      setTranscript(result.text);

      if (cleanupFallback) {
        assertDeliveryActive();
        toast({
          title: "Original transcript preserved",
          description: cleanupFallbackFeedback.description,
          variant: "default",
          duration: 5000,
        });
      }

      let pasteSucceeded = false;
      let clipboardSucceeded = false;
      let deliveryStatus = "pending";
      let deliveryError = null;
      let deliveryReasonCode = null;
      let pasteMs = null;
      const isForegroundAvailable = () => !recordingSessionIdRef.current;

      if (session.outputMode === "insert") {
        assertDeliveryActive();
        if (isForegroundAvailable()) {
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
          pasteOptions.sessionId = session.sessionId;
        }
        logger.info(
          "Paste attempt",
          {
            sessionId: session.sessionId,
            jobId,
            source: result.source,
            textLength: result.text.length,
            fromStreaming: pasteOptions.fromStreaming === true,
            hasInsertionTarget: Boolean(session.insertionTarget),
          },
          "paste"
        );
        assertDeliveryActive();
        const pasteResult =
          typeof audioManager.safePasteWithResult === "function"
            ? await audioManager.safePasteWithResult(result.text, pasteOptions)
            : {
                success: await audioManager.safePaste(result.text, pasteOptions),
                errorCode: null,
              };
        pasteSucceeded = pasteResult?.success === true;
        const clipboardRestoreWarning = Boolean(
          pasteSucceeded &&
          pasteResult?.inserted === true &&
          pasteResult?.clipboardRestored === false
        );
        if (clipboardRestoreWarning) {
          deliveryReasonCode = pasteResult?.warningCode || "WINDOWS_CLIPBOARD_RESTORE_FAILED";
        } else if (!pasteSucceeded) {
          deliveryReasonCode = pasteResult?.errorCode || "AUTOMATIC_INSERTION_FAILED";
        }
        assertDeliveryActive();
        pasteMs = Math.round(performance.now() - pasteStart);
        if (clipboardRestoreWarning) {
          deliveryStatus = "inserted_clipboard_warning";
          deliveryError =
            "Text was inserted, but the previous clipboard contents could not yet be restored.";
          toast({
            title: "Text inserted—clipboard recovery pending",
            description:
              "Do not paste again. EchoDraft will retry restoring your previous clipboard before the next insertion.",
            variant: "default",
            duration: 6000,
          });
        } else if (pasteSucceeded) {
          deliveryStatus = "inserted";
        } else if (CLIPBOARD_PROTECTION_FAILURE_CODES.has(deliveryReasonCode)) {
          // This failure is intentionally raised before the main process touches a clipboard
          // it cannot safely mutate. A generic clipboard fallback here would defeat that
          // protection, so retain the text on screen/history and offer explicit recovery.
          const restorationPending = deliveryReasonCode === "WINDOWS_CLIPBOARD_RESTORE_PENDING";
          deliveryStatus = "clipboard_protected";
          deliveryError = restorationPending
            ? "Automatic insertion paused while EchoDraft protects clipboard data from the previous insertion."
            : "Automatic insertion paused because the existing clipboard could not be restored safely.";
          toast({
            title: restorationPending
              ? "Insert paused—clipboard recovery pending"
              : "Insert paused—clipboard protected",
            description: restorationPending
              ? "EchoDraft will retry the previous clipboard recovery. This dictation remains in History."
              : "EchoDraft left your clipboard unchanged. Use Copy Last Dictation from the tray or History.",
            variant: "default",
            duration: 6000,
          });
        } else {
          try {
            assertDeliveryActive();
            if (typeof electronAPI?.writeClipboard !== "function") {
              throw new Error("Clipboard API unavailable");
            }
            const clipboardResult = await electronAPI.writeClipboard(result.text);
            assertDeliveryActive();
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
            assertDeliveryActive();
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
          assertDeliveryActive();
          if (typeof electronAPI?.writeClipboard !== "function") {
            throw new Error("Clipboard API unavailable");
          }
          const clipboardResult = await electronAPI.writeClipboard(result.text);
          assertDeliveryActive();
          if (clipboardResult?.success === false) {
            throw new Error(clipboardResult.error || "Clipboard write failed");
          }
          clipboardSucceeded = true;
          deliveryStatus = "clipboard";
        } catch (error) {
          assertDeliveryActive();
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

        assertDeliveryActive();
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

      assertDeliveryActive();
      if (isForegroundAvailable()) {
        updateStage("saving", {
          outputMode: session.outputMode,
          sessionId: session.sessionId,
          ...(jobId !== null ? { jobId } : {}),
        });
      }

      const saveStart = performance.now();
      const recordDurationMs =
        typeof job?.recordedMs === "number" && job.recordedMs > 0
          ? Math.round(job.recordedMs)
          : null;
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
      const deliverySucceeded = [
        "inserted",
        "inserted_clipboard_warning",
        "clipboard",
        "clipboard_fallback",
      ].includes(deliveryStatus);
      // A clipboard fallback preserves the user's text, but automatic delivery still
      // failed. Keep that distinction visible in history and diagnostic exports.
      const historyStatus = ["inserted", "clipboard"].includes(deliveryStatus)
        ? "success"
        : "delivery_issue";

      assertDeliveryActive();
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
          pasteSucceeded,
          clipboardSucceeded,
          delivery: {
            status: deliveryStatus,
            succeeded: deliverySucceeded,
            ...(deliveryReasonCode ? { reasonCode: deliveryReasonCode } : {}),
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
      assertDeliveryActive();
      const saveSucceeded = Boolean(saveResult?.success);
      const savedId = saveResult?.id || saveResult?.transcription?.id;
      const saveMs = Math.round(performance.now() - saveStart);
      const totalDurationMs =
        typeof job?.startedAt === "number" && job.startedAt > 0
          ? Math.max(0, Date.now() - job.startedAt)
          : null;

      if (saveSucceeded && savedId && electronAPI?.patchTranscriptionMeta) {
        try {
          assertDeliveryActive();
          await electronAPI.patchTranscriptionMeta(savedId, {
            provider,
            model,
            timings: {
              ...baseTimings,
              saveDurationMs: saveMs,
              totalDurationMs,
            },
          });
          assertDeliveryActive();
        } catch (error) {
          assertDeliveryActive();
          logger.warn(
            "Failed to patch transcription metadata",
            { error: error?.message, id: savedId },
            "transcription"
          );
        }
      }

      assertDeliveryActive();
      if (!saveSucceeded) {
        const fallbackDescription =
          deliveryStatus === "inserted" || deliveryStatus === "inserted_clipboard_warning"
            ? deliveryStatus === "inserted_clipboard_warning"
              ? "Text was inserted, but clipboard restoration and history saving failed."
              : "Text was inserted, but saving to history failed."
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
        assertDeliveryActive();
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
        assertDeliveryActive();
        electronAPI?.notifyLimitReached?.({
          wordsUsed: result.wordsUsed,
          limit:
            result.wordsRemaining !== undefined ? result.wordsUsed + result.wordsRemaining : 2000,
        });
      }

      assertDeliveryActive();
      if (isForegroundAvailable()) {
        const terminalStage =
          deliveryStatus === "failed"
            ? "error"
            : deliveryStatus === "clipboard_fallback" ||
                deliveryStatus === "inserted_clipboard_warning" ||
                deliveryStatus === "clipboard_protected" ||
                !saveSucceeded ||
                cleanupFallback
              ? "warning"
              : "done";
        updateStage(terminalStage, {
          outputMode: session.outputMode,
          sessionId: session.sessionId,
          ...(jobId !== null ? { jobId } : {}),
          stageProgress: 1,
          overallProgress: 1,
          message:
            deliveryStatus === "clipboard_fallback"
              ? "Insert failed; text kept in clipboard."
              : deliveryStatus === "inserted_clipboard_warning"
                ? "Inserted; previous clipboard recovery is pending."
                : deliveryStatus === "clipboard_protected"
                  ? deliveryReasonCode === "WINDOWS_CLIPBOARD_RESTORE_PENDING"
                    ? "Insert paused; previous clipboard recovery is still pending."
                    : "Insert paused; existing clipboard left unchanged."
                  : deliveryStatus === "failed"
                    ? "Automatic text delivery failed."
                    : saveSucceeded
                      ? cleanupFallback
                        ? cleanupFallbackFeedback.stageMessage
                        : null
                      : session.outputMode === "insert" && pasteSucceeded
                        ? "Inserted, but history save failed."
                        : "Saved to clipboard, but history save failed.",
          provider,
          model,
          generatedChars: result.text.length,
          generatedWords: countWords(result.text),
        });

        if (
          terminalStage === "done" &&
          deliverySucceeded &&
          saveSucceeded &&
          !cleanupFallback &&
          saveMs > 0
        ) {
          setProgress((prev) => ({
            ...prev,
            message: `Saved in ${saveMs}ms`,
          }));
        }
      }

      if (resolvedSessionId) {
        assertDeliveryActive();
        upsertJob(resolvedSessionId, {
          status: deliveryStatus === "failed" ? "error" : "done",
          provider,
          model,
          outputMode: session.outputMode,
        });
        setTimeout(() => removeJob(resolvedSessionId), 1500);
      }

      assertDeliveryActive();
      // A queued job may finish while the user is already recording the next one.
      // Keep the live-microphone cue authoritative instead of overlaying a stale
      // completion, warning, or error sound from background work.
      if (isForegroundAvailable()) {
        if (deliveryStatus === "failed") {
          void playErrorCue?.();
        } else if (
          deliveryStatus === "clipboard_fallback" ||
          deliveryStatus === "inserted_clipboard_warning" ||
          deliveryStatus === "clipboard_protected" ||
          !saveSucceeded ||
          cleanupFallback
        ) {
          void playWarningCue?.();
        } else if (deliverySucceeded) {
          void playCompletionCue?.();
        }
      }
      assertDeliveryActive();
      audioManager.warmupStreamingConnection();
    } finally {
      deliveryCommitCountRef.current = Math.max(0, deliveryCommitCountRef.current - 1);
    }
  };
};
