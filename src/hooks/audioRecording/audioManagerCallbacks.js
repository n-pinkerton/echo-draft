import logger from "../../utils/logger";
import { getRendererLogLevel } from "../../utils/branding";
import { countWords } from "./textMetrics";
import { STAGE_META } from "./stages";
import { getMobileInboxRequestId, mobileInboxRequestOwnsSession } from "./mobileInbox";

export const createAudioManagerCallbacks = (deps) => {
  const {
    activeSessionRef,
    audioManagerRef,
    jobsBySessionIdRef,
    latestProgressRef,
    mobileInboxRequestBySessionIdRef,
    sessionsByIdRef,
    recordingSessionIdRef,
    removeJob,
    resetProgress,
    setIsProcessing,
    setIsRecording,
    setIsStreaming,
    setPartialTranscript,
    setProgress,
    toast,
    updateStage,
    upsertJob,
    onTranscriptionComplete,
    onProcessingError,
    playErrorCue,
    playStopCue,
  } = deps;

  return {
    onStateChange: ({ isRecording, isProcessing, isStreaming }) => {
      setIsRecording(isRecording);
      setIsProcessing(isProcessing);
      setIsStreaming(isStreaming ?? false);

      logger.trace(
        "AudioManager state change",
        { isRecording, isProcessing, isStreaming },
        "dictation"
      );

      if (!isStreaming) {
        setPartialTranscript("");
      }
    },
    onError: (error = {}) => {
      try {
        if (onProcessingError?.(error) === true) return;
      } catch (interceptError) {
        logger.error("Processing error interceptor failed", interceptError, "dictation");
      }
      const errorSessionId =
        typeof error?.context?.sessionId === "string" && error.context.sessionId.trim()
          ? error.context.sessionId.trim()
          : null;
      const recordingSessionId = recordingSessionIdRef.current;
      const targetsActiveRecording = Boolean(
        recordingSessionId && (!errorSessionId || errorSessionId === recordingSessionId)
      );
      const retiresUnqueuedRecording =
        error.code === "RECORDER_STOP_TIMEOUT" && Boolean(errorSessionId);

      if (!recordingSessionId || targetsActiveRecording) {
        void playErrorCue?.();
      }

      if (retiresUnqueuedRecording) {
        // A recorder-stop timeout never admitted audio to the processing FIFO.
        // Retire only that session so it cannot remain as a ghost processing job
        // in the tray or make a replacement dictation appear queued.
        sessionsByIdRef?.current?.delete?.(errorSessionId);
        removeJob?.(errorSessionId);
      } else if (errorSessionId && !targetsActiveRecording) {
        sessionsByIdRef?.current?.delete?.(errorSessionId);
      }
      if (
        targetsActiveRecording ||
        (!recordingSessionId &&
          (!errorSessionId || activeSessionRef.current?.sessionId === errorSessionId))
      ) {
        activeSessionRef.current = null;
      }
      if (targetsActiveRecording) {
        recordingSessionIdRef.current = null;
      }

      if (!recordingSessionId || targetsActiveRecording) {
        updateStage("error", {
          message: error.description || error.message || "An unknown error occurred",
          ...(errorSessionId ? { sessionId: errorSessionId } : {}),
        });
      }

      logger.error("Dictation error", error, "dictation");

      const title =
        error.code === "AUTH_EXPIRED"
          ? "Session Expired"
          : error.code === "OFFLINE"
            ? "You're Offline"
            : error.code === "LIMIT_REACHED"
              ? "Daily Limit Reached"
              : error.title;

      toast({
        title,
        description: error.description,
        variant: "destructive",
        duration: error.code === "AUTH_EXPIRED" ? 8000 : undefined,
      });
    },
    onProgress: (event = {}) => {
      if (!event || typeof event !== "object") {
        return;
      }

      if (event.recordingClosed === true) {
        void playStopCue?.();
      }

      const contextSessionId =
        typeof event?.context?.sessionId === "string" ? event.context.sessionId : null;
      const mobileInboxRequestId = getMobileInboxRequestId(event?.context);
      const currentJob = contextSessionId
        ? jobsBySessionIdRef?.current?.get?.(contextSessionId)
        : null;
      if (
        mobileInboxRequestId &&
        !mobileInboxRequestOwnsSession(
          mobileInboxRequestBySessionIdRef,
          contextSessionId,
          mobileInboxRequestId,
          currentJob
        )
      ) {
        return;
      }
      const jobIdFromEvent =
        typeof event?.jobId === "number" && Number.isFinite(event.jobId) ? event.jobId : null;

      if (contextSessionId) {
        const nextStatus =
          event.stage === "listening"
            ? "recording"
            : event.stage === "queued"
              ? "queued"
              : event.stage === "cancelled"
                ? "cancelled"
                : event.stage === "error"
                  ? "error"
                  : "processing";

        const jobPatch = { status: nextStatus };
        if (mobileInboxRequestId) {
          jobPatch.mobileInboxRequestId = mobileInboxRequestId;
        }
        if (jobIdFromEvent !== null) {
          jobPatch.jobId = jobIdFromEvent;
        }
        if (event?.context?.outputMode) {
          jobPatch.outputMode = event.context.outputMode;
        }
        if (event.provider) {
          jobPatch.provider = event.provider;
        }
        if (event.model) {
          jobPatch.model = event.model;
        }
        upsertJob(contextSessionId, jobPatch);
      }

      if (event.stage) {
        const shouldUpdateForeground =
          !recordingSessionIdRef.current ||
          (contextSessionId && contextSessionId === recordingSessionIdRef.current);

        if (shouldUpdateForeground) {
          updateStage(event.stage, {
            stageLabel: event.stageLabel,
            stageProgress: event.stageProgress,
            overallProgress: event.overallProgress,
            generatedChars: event.generatedChars,
            generatedWords: event.generatedWords,
            provider: event.provider,
            model: event.model,
            message: event.message,
            isSlow: event.isSlow,
            canCancel: event.canCancel,
            transportAttempt: event.transportAttempt,
            transportRetrying: event.transportRetrying,
            ...(contextSessionId ? { sessionId: contextSessionId } : {}),
            ...(jobIdFromEvent !== null ? { jobId: jobIdFromEvent } : {}),
            ...(event?.context?.outputMode ? { outputMode: event.context.outputMode } : {}),
          });
        }

        if (contextSessionId && (event.stage === "error" || event.stage === "cancelled")) {
          setTimeout(() => {
            if (
              mobileInboxRequestId &&
              !mobileInboxRequestOwnsSession(
                mobileInboxRequestBySessionIdRef,
                contextSessionId,
                mobileInboxRequestId,
                jobsBySessionIdRef?.current?.get?.(contextSessionId)
              )
            ) {
              return;
            }
            removeJob(contextSessionId);
            const state = audioManagerRef.current?.getState?.();
            const latestProgress = latestProgressRef?.current;
            const ownsTerminalProgress =
              latestProgress?.sessionId === contextSessionId &&
              (latestProgress.stage === "error" || latestProgress.stage === "cancelled");
            if (
              ownsTerminalProgress &&
              !state?.isRecording &&
              !state?.isProcessing &&
              jobsBySessionIdRef?.current?.size === 0
            ) {
              resetProgress?.();
            }
          }, 3000);
        }

        logger.trace(
          "Pipeline progress",
          {
            stage: event.stage,
            stageLabel: event.stageLabel,
            message: event.message,
            provider: event.provider,
            model: event.model,
            generatedChars: event.generatedChars,
            generatedWords: event.generatedWords,
            sessionId: contextSessionId,
            jobId: jobIdFromEvent,
          },
          "pipeline"
        );
        return;
      }

      const shouldUpdateProgressCounters =
        !recordingSessionIdRef.current || audioManagerRef.current?.getState?.()?.isStreaming;
      if (!shouldUpdateProgressCounters) {
        return;
      }

      setProgress((prev) => ({
        ...prev,
        generatedChars:
          event.generatedChars !== undefined ? event.generatedChars : prev.generatedChars,
        generatedWords:
          event.generatedWords !== undefined ? event.generatedWords : prev.generatedWords,
        provider: event.provider !== undefined ? event.provider : prev.provider,
        model: event.model !== undefined ? event.model : prev.model,
        message: event.message !== undefined ? event.message : prev.message,
        isSlow: event.isSlow !== undefined ? event.isSlow : prev.isSlow,
        canCancel: event.canCancel !== undefined ? event.canCancel : prev.canCancel,
        transportAttempt:
          event.transportAttempt !== undefined ? event.transportAttempt : prev.transportAttempt,
        transportRetrying:
          event.transportRetrying !== undefined ? event.transportRetrying : prev.transportRetrying,
      }));
    },
    onPartialTranscript: (text, context = null) => {
      const partialSessionId =
        typeof context?.sessionId === "string" && context.sessionId.trim()
          ? context.sessionId.trim()
          : null;
      if (
        recordingSessionIdRef.current &&
        partialSessionId &&
        partialSessionId !== recordingSessionIdRef.current
      ) {
        return;
      }

      setPartialTranscript(text);

      if (getRendererLogLevel() === "trace") {
        logger.trace(
          "Partial transcript",
          {
            sessionId: partialSessionId || recordingSessionIdRef.current,
            textLength: text.length,
          },
          "dictation"
        );
      }

      setProgress((prev) => {
        if (prev.stage !== "listening" && prev.stage !== "transcribing") {
          return prev;
        }
        const stage = prev.stage === "listening" ? "listening" : "transcribing";
        return {
          ...prev,
          stage,
          stageLabel: STAGE_META[stage].label,
          generatedChars: text.length,
          generatedWords: countWords(text),
        };
      });
    },
    onTranscriptionComplete: onTranscriptionComplete,
  };
};
