import logger from "../../utils/logger";
import { STAGE_META, TERMINAL_STAGES } from "./stages";

export const createStageUpdater = (deps) => {
  const {
    audioManagerRef,
    clearProgressResetTimer,
    jobsBySessionIdRef,
    latestProgressRef,
    progressResetTimerRef,
    recordingStartedAtRef,
    resetProgress,
    sessionStartedAtRef,
    setProgress,
  } = deps;

  return (stage, patch = {}) => {
    const normalizedStage = STAGE_META[stage] ? stage : "idle";
    const now = Date.now();

    const previousSessionId = latestProgressRef.current?.sessionId;
    const nextSessionId = patch.sessionId || previousSessionId;
    const previousStage = latestProgressRef.current?.stage;
    const nextJobId = patch.jobId !== undefined ? patch.jobId : (latestProgressRef.current?.jobId ?? null);
    const nextOutputMode = patch.outputMode || latestProgressRef.current?.outputMode || null;
    const stageChanged =
      previousStage !== normalizedStage || (nextSessionId && nextSessionId !== previousSessionId);

    if (stageChanged) {
      logger.trace(
        "Stage transition",
        {
          fromStage: previousStage,
          toStage: normalizedStage,
          sessionId: nextSessionId,
          jobId: nextJobId,
          outputMode: nextOutputMode,
          provider: patch.provider,
          model: patch.model,
          message: patch.message,
        },
        "pipeline"
      );
    }

    if (nextSessionId && nextSessionId !== previousSessionId) {
      sessionStartedAtRef.current = now;
      recordingStartedAtRef.current = null;
    } else if (!sessionStartedAtRef.current) {
      sessionStartedAtRef.current = now;
    }

    if (normalizedStage === "listening" && !recordingStartedAtRef.current) {
      recordingStartedAtRef.current = now;
    } else if (normalizedStage !== "listening") {
      recordingStartedAtRef.current = null;
    }

    clearProgressResetTimer();

    setProgress((prev) => {
      const defaultMeta = STAGE_META[normalizedStage] || STAGE_META.idle;
      const elapsedMs = Math.max(0, now - (sessionStartedAtRef.current || now));
      const nextStageProgress =
        patch.stageProgress !== undefined
          ? patch.stageProgress
          : TERMINAL_STAGES.has(normalizedStage)
            ? 1
            : null;

      return {
        ...prev,
        stage: normalizedStage,
        stageLabel: patch.stageLabel || defaultMeta.label,
        stageProgress: nextStageProgress,
        overallProgress:
          patch.overallProgress !== undefined ? patch.overallProgress : defaultMeta.overallProgress,
        elapsedMs,
        recordedMs:
          patch.recordedMs !== undefined
            ? patch.recordedMs
            : normalizedStage === "listening" && recordingStartedAtRef.current
              ? Math.max(0, now - recordingStartedAtRef.current)
              : prev.recordedMs,
        generatedChars:
          patch.generatedChars !== undefined
            ? patch.generatedChars
            : normalizedStage === "transcribing"
              ? prev.generatedChars
              : 0,
        generatedWords:
          patch.generatedWords !== undefined
            ? patch.generatedWords
            : normalizedStage === "transcribing"
              ? prev.generatedWords
              : 0,
        provider: patch.provider !== undefined ? patch.provider : prev.provider,
        model: patch.model !== undefined ? patch.model : prev.model,
        message: patch.message !== undefined ? patch.message : null,
        outputMode: patch.outputMode || prev.outputMode,
        sessionId: patch.sessionId || prev.sessionId,
        jobId: patch.jobId !== undefined ? patch.jobId : prev.jobId,
      };
    });

    if (TERMINAL_STAGES.has(normalizedStage)) {
      progressResetTimerRef.current = setTimeout(() => {
        const state = audioManagerRef.current?.getState?.();
        if (state?.isRecording || state?.isProcessing || jobsBySessionIdRef.current.size > 0) {
          return;
        }
        resetProgress();
      }, 3000);
    }
  };
};

