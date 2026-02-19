import logger from "../../utils/logger";
import { countWords } from "./textMetrics";
import { STAGE_META } from "./stages";

export const createAudioManagerCallbacks = (deps) => {
  const {
    activeSessionRef,
    audioManagerRef,
    recordingSessionIdRef,
    removeJob,
    setIsProcessing,
    setIsRecording,
    setIsStreaming,
    setPartialTranscript,
    setProgress,
    toast,
    updateStage,
    upsertJob,
    onTranscriptionComplete,
  } = deps;

  return {
    onStateChange: ({ isRecording, isProcessing, isStreaming }) => {
      setIsRecording(isRecording);
      setIsProcessing(isProcessing);
      setIsStreaming(isStreaming ?? false);

      logger.trace("AudioManager state change", { isRecording, isProcessing, isStreaming }, "dictation");

      if (!isStreaming) {
        setPartialTranscript("");
      }
    },
    onError: (error) => {
      activeSessionRef.current = null;
      const wasRecording = Boolean(recordingSessionIdRef.current);
      recordingSessionIdRef.current = null;
      if (!wasRecording) {
        updateStage("error", {
          message: error.description || error.message || "An unknown error occurred",
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

      const contextSessionId = typeof event?.context?.sessionId === "string" ? event.context.sessionId : null;
      const jobIdFromEvent =
        typeof event?.jobId === "number" && Number.isFinite(event.jobId) ? event.jobId : null;

      if (contextSessionId) {
        const nextStatus =
          event.stage === "listening"
            ? "recording"
            : event.stage === "cancelled"
              ? "cancelled"
              : event.stage === "error"
                ? "error"
                : "processing";

        const jobPatch = { status: nextStatus };
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
            ...(contextSessionId ? { sessionId: contextSessionId } : {}),
            ...(jobIdFromEvent !== null ? { jobId: jobIdFromEvent } : {}),
            ...(event?.context?.outputMode ? { outputMode: event.context.outputMode } : {}),
          });
        }

        if (contextSessionId && (event.stage === "error" || event.stage === "cancelled")) {
          setTimeout(() => removeJob(contextSessionId), 3000);
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
        generatedChars: event.generatedChars !== undefined ? event.generatedChars : prev.generatedChars,
        generatedWords: event.generatedWords !== undefined ? event.generatedWords : prev.generatedWords,
        provider: event.provider !== undefined ? event.provider : prev.provider,
        model: event.model !== undefined ? event.model : prev.model,
        message: event.message !== undefined ? event.message : prev.message,
      }));
    },
    onPartialTranscript: (text) => {
      setPartialTranscript(text);

      if (typeof window !== "undefined" && window.__openwhisprLogLevel === "trace") {
        logger.trace(
          "Partial transcript",
          {
            sessionId: recordingSessionIdRef.current,
            textLength: text.length,
            text,
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

