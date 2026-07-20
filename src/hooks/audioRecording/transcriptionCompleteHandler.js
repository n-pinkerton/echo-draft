import logger from "../../utils/logger";
import { ECHO_DRAFT_CLOUD_SOURCE, normalizeEchoDraftSource } from "../../utils/branding";
import { throwIfTranscriptionCancelled } from "../../helpers/audio/pipeline/cancellation";
import { cleanupAppliedPreferredSpelling } from "../../utils/cleanupOutcome";
import { countWords } from "./textMetrics";
import { normalizeCleanupTitle } from "../../config/cleanupOutputContract.cjs";
import {
  canShowMobileInboxTerminal,
  createMobileInboxCompletion,
  getMobileInboxRequestId,
  getMobileInboxTerminalProgress,
  mobileInboxRequestOwnsSession,
} from "./mobileInbox";
import {
  getHistoryStatus,
  isDeliverySucceeded,
  planPasteDeliveryOutcome,
} from "./transcriptionDeliveryPolicy";

export const getCleanupFallbackFeedback = (
  fallbackReason,
  retryCount = 0,
  preferredSpellingApplied = false
) => {
  const appliedDictionarySpelling = preferredSpellingApplied === true;
  const preservedDescription = appliedDictionarySpelling
    ? "EchoDraft applied a verified dictionary spelling and otherwise kept the original transcript."
    : "EchoDraft kept every original word.";
  const title = appliedDictionarySpelling
    ? "Transcript preserved with dictionary spelling"
    : "Original transcript preserved";

  if (fallbackReason === "fidelity_rejected") {
    const retryAttempted = Number(retryCount) > 0;
    return {
      title,
      description: `${
        retryAttempted
          ? "Both AI cleanup attempts failed preservation checks."
          : "AI cleanup failed preservation checks."
      } ${preservedDescription}`,
      stageMessage: appliedDictionarySpelling
        ? "Cleanup fallback used; verified dictionary spelling applied."
        : retryAttempted
          ? "Original transcript used; neither cleanup attempt passed preservation checks."
          : "Original transcript used; cleanup did not pass preservation checks.",
    };
  }
  if (fallbackReason === "not_configured") {
    return {
      title,
      description: `AI cleanup is not configured. ${preservedDescription}`,
      stageMessage: appliedDictionarySpelling
        ? "Cleanup needs setup; verified dictionary spelling applied."
        : "Original transcript used; cleanup needs setup.",
    };
  }
  if (fallbackReason === "unavailable") {
    return {
      title,
      description: `AI cleanup was unavailable. ${preservedDescription}`,
      stageMessage: appliedDictionarySpelling
        ? "Cleanup unavailable; verified dictionary spelling applied."
        : "Original transcript used; cleanup was unavailable.",
    };
  }
  return {
    title,
    description: `The AI cleanup request failed. ${preservedDescription}`,
    stageMessage: appliedDictionarySpelling
      ? "Cleanup request failed; verified dictionary spelling applied."
      : "Original transcript used; cleanup request failed.",
  };
};

export const createTranscriptionCompleteHandler = (deps) => {
  const {
    activeSessionRef,
    audioManagerRef,
    jobsBySessionIdRef,
    latestProgressRef,
    mobileInboxRequestBySessionIdRef,
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
  const completeMobileInboxRequest = deps.completeMobileInboxRequest;

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

    const mobileInboxRequestId = getMobileInboxRequestId(result?.context);

    if (resolvedSessionId) {
      sessionsByIdRef.current.delete(resolvedSessionId);
    }
    if (activeSessionRef.current?.sessionId === resolvedSessionId) {
      activeSessionRef.current = null;
    }

    if (mobileInboxRequestId) {
      const completion = createMobileInboxCompletion(
        result,
        mobileInboxRequestOwnsSession(
          mobileInboxRequestBySessionIdRef,
          resolvedSessionId,
          mobileInboxRequestId,
          job
        )
          ? job
          : null
      );
      let completionAccepted = false;
      deliveryCommitCountRef.current += 1;
      try {
        let response;
        if (completeMobileInboxRequest) {
          response = await completeMobileInboxRequest(result.context, completion);
        } else {
          response = await electronAPI?.completeMobileInboxItem?.(mobileInboxRequestId, completion);
        }
        completionAccepted = response?.success === true;
      } catch (error) {
        logger.warn(
          "Failed to report mobile inbox completion",
          { error: error?.message || String(error) },
          "transcription"
        );
      } finally {
        deliveryCommitCountRef.current = Math.max(0, deliveryCommitCountRef.current - 1);
      }
      const currentJob = resolvedSessionId
        ? jobsBySessionIdRef.current.get(resolvedSessionId)
        : null;
      const ownsCurrentJob = mobileInboxRequestOwnsSession(
        mobileInboxRequestBySessionIdRef,
        resolvedSessionId,
        mobileInboxRequestId,
        currentJob
      );
      if (resolvedSessionId && ownsCurrentJob) removeJob(resolvedSessionId);
      if (
        ownsCurrentJob &&
        canShowMobileInboxTerminal({
          recordingSessionId: recordingSessionIdRef.current,
          progressSessionId: latestProgressRef?.current?.sessionId,
          mobileSessionId: resolvedSessionId,
        })
      ) {
        const terminalProgress = getMobileInboxTerminalProgress(
          completion.success === true && completionAccepted
        );
        updateStage(terminalProgress.stage, {
          ...terminalProgress,
          outputMode: "mobile-todo",
          sessionId: session.sessionId,
          ...(jobId !== null ? { jobId } : {}),
        });
      }
      return;
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
      ? getCleanupFallbackFeedback(
          cleanup?.fallbackReason,
          cleanup?.retryCount,
          cleanupAppliedPreferredSpelling(cleanup)
        )
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
          title: cleanupFallbackFeedback.title,
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

      const suspectedIncomplete = result?.suspectedIncomplete === true;
      if (suspectedIncomplete) {
        deliveryStatus = "transcription_incomplete";
        deliveryReasonCode = "TRANSCRIPTION_RECOVERY_FAILED";
        deliveryError =
          "The transcript may be incomplete because an independent recovery attempt failed.";
        // Insert mode may be protecting custom clipboard formats or a pending
        // restoration from an earlier insertion. Keep the incomplete text in
        // History/Copy Last Dictation without touching either target or clipboard.
        if (session.outputMode === "clipboard") {
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
          } catch (error) {
            assertDeliveryActive();
            deliveryError = `${deliveryError} Clipboard recovery also failed: ${error?.message || String(error)}`;
            logger.warn(
              "Failed to retain a suspected-incomplete transcript in the clipboard",
              { error: error?.message || String(error) },
              "clipboard"
            );
          }
        }
        toast({
          title: "Transcript may be incomplete",
          description:
            session.outputMode === "insert"
              ? "EchoDraft did not insert it or replace your clipboard. Review it in History or Copy Last Dictation, and retry the recording if needed."
              : clipboardSucceeded
                ? "Review the clipboard copy or History before using it, and retry the recording if needed."
                : "Review the text in History, and retry the recording if needed.",
          variant: "default",
          duration: 8000,
        });
      } else if (session.outputMode === "insert") {
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
        const pasteOutcome = planPasteDeliveryOutcome(pasteResult);
        pasteSucceeded = pasteOutcome.pasteSucceeded;
        const transcriptAlreadyInClipboard = pasteOutcome.transcriptAlreadyInClipboard;
        const clipboardChangedAfterPaste = pasteOutcome.clipboardChangedAfterPaste;
        deliveryReasonCode = pasteOutcome.deliveryReasonCode;
        assertDeliveryActive();
        pasteMs = Math.round(performance.now() - pasteStart);
        if (pasteOutcome.deliveryStatus === "inserted_clipboard_warning") {
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
        } else if (pasteOutcome.deliveryStatus === "inserted") {
          deliveryStatus = "inserted";
        } else if (pasteOutcome.deliveryStatus === "insert_uncertain") {
          // A partial SendInput can include Ctrl-down and V-down, which may already
          // have pasted the text. Keep recovery available without inviting a second,
          // potentially duplicate paste.
          clipboardSucceeded = transcriptAlreadyInClipboard;
          deliveryStatus = "insert_uncertain";
          deliveryError =
            "Windows may have inserted the text, but could not confirm the complete shortcut.";
          toast({
            title: "Insert may have completed",
            description: transcriptAlreadyInClipboard
              ? "Check the target before pasting again. A recovery copy remains in the clipboard and History."
              : clipboardChangedAfterPaste
                ? "Check the target before pasting again. Newer clipboard contents were preserved; this dictation remains in History."
                : "Check the target before pasting again. This dictation remains in History and under Copy Last Dictation.",
            variant: "default",
            duration: 7000,
          });
        } else if (pasteOutcome.deliveryStatus === "clipboard_protected") {
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
        } else if (pasteOutcome.deliveryStatus === "clipboard_fallback") {
          clipboardSucceeded = true;
          deliveryStatus = "clipboard_fallback";
          deliveryError = "Automatic insertion failed; text was kept in the clipboard.";
          toast({
            title: "Insert failed—text kept in clipboard",
            description: "Paste it manually with Ctrl+V.",
            variant: "default",
            duration: 5000,
          });
        } else if (pasteOutcome.deliveryStatus === "clipboard_changed") {
          deliveryStatus = "clipboard_changed";
          deliveryError =
            "Automatic insertion failed; EchoDraft preserved newer clipboard contents instead of overwriting them.";
          toast({
            title: "Insert failed—newer clipboard kept",
            description: "This dictation remains in History and under Copy Last Dictation.",
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
      const dictationTitle = normalizeCleanupTitle(result.title);
      const deliverySucceeded = isDeliverySucceeded(deliveryStatus);
      // A clipboard fallback preserves the user's text, but automatic delivery still
      // failed. Keep that distinction visible in history and diagnostic exports.
      const historyStatus = getHistoryStatus(deliveryStatus);

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
          ...(dictationTitle ? { title: dictationTitle } : {}),
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
            : deliveryStatus === "transcription_incomplete"
              ? "The transcript may be incomplete, and saving it to History failed. Use Copy Last Dictation from the tray to recover the text."
              : deliveryStatus === "insert_uncertain"
                ? "Windows may have inserted the text, but confirmation and history saving both failed. Check the target before pasting again; use Copy Last Dictation from the tray to recover it."
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
                deliveryStatus === "transcription_incomplete" ||
                deliveryStatus === "insert_uncertain" ||
                deliveryStatus === "inserted_clipboard_warning" ||
                deliveryStatus === "clipboard_protected" ||
                deliveryStatus === "clipboard_changed" ||
                !saveSucceeded ||
                cleanupFallback
              ? "warning"
              : "done";
        const terminalStageLabel =
          deliveryStatus === "clipboard_protected"
            ? "Insert paused"
            : deliveryStatus === "clipboard_fallback" || deliveryStatus === "clipboard_changed"
              ? "Insert failed"
              : deliveryStatus === "insert_uncertain"
                ? "Insert unconfirmed"
                : deliveryStatus === "transcription_incomplete"
                  ? "Transcript needs review"
                  : deliveryStatus === "inserted_clipboard_warning"
                    ? "Inserted with warning"
                    : deliveryStatus === "failed"
                      ? "Delivery failed"
                      : undefined;
        updateStage(terminalStage, {
          outputMode: session.outputMode,
          sessionId: session.sessionId,
          ...(jobId !== null ? { jobId } : {}),
          stageProgress: 1,
          overallProgress: 1,
          ...(terminalStageLabel ? { stageLabel: terminalStageLabel } : {}),
          message:
            deliveryStatus === "clipboard_fallback"
              ? "Insert failed; text kept in clipboard."
              : deliveryStatus === "transcription_incomplete"
                ? session.outputMode === "insert"
                  ? "Transcript may be incomplete; automatic insertion was skipped."
                  : "Transcript may be incomplete; review it before use."
              : deliveryStatus === "insert_uncertain"
                ? "Insert may have completed; check before pasting again."
              : deliveryStatus === "inserted_clipboard_warning"
                ? "Inserted; previous clipboard recovery is pending."
                : deliveryStatus === "clipboard_protected"
                  ? deliveryReasonCode === "WINDOWS_CLIPBOARD_RESTORE_PENDING"
                    ? "Insert paused; previous clipboard recovery is still pending."
                    : "Insert paused; existing clipboard left unchanged."
                  : deliveryStatus === "clipboard_changed"
                    ? "Insert failed; newer clipboard contents preserved."
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
          deliveryStatus === "transcription_incomplete" ||
          deliveryStatus === "insert_uncertain" ||
          deliveryStatus === "inserted_clipboard_warning" ||
          deliveryStatus === "clipboard_protected" ||
          deliveryStatus === "clipboard_changed" ||
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
