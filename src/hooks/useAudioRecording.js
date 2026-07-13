import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import AudioManager from "../helpers/audioManager";
import {
  playCancelCue,
  playCompletionCue,
  playErrorCue,
  playWarningCue,
  playStartCue,
  playStopCue,
} from "../utils/dictationCues";
import { INITIAL_PROGRESS } from "./audioRecording/stages";
import {
  createSessionId as createSessionIdBase,
  normalizeTriggerPayload as normalizeTriggerPayloadBase,
} from "./audioRecording/triggerPayload";
import { createAudioManagerCallbacks } from "./audioRecording/audioManagerCallbacks";
import { installE2EHelpers } from "./audioRecording/e2eHelpers";
import {
  createRecordingOperationQueue,
  createStartRecordingHandler,
  createStopRecordingHandler,
} from "./audioRecording/recordingHandlers";
import { createStageUpdater } from "./audioRecording/stageUpdater";
import { createTranscriptionCompleteHandler } from "./audioRecording/transcriptionCompleteHandler";

const SLOW_STAGE_THRESHOLD_MS = 10_000;

const getSlowStageMessage = (progress) => {
  if (progress.stage === "cleaning") {
    return "Cleanup is taking longer than usual";
  }
  if (progress.provider === "openai") return "OpenAI is taking longer than usual";
  if (progress.provider === "groq") return "Groq is taking longer than usual";
  if (String(progress.provider || "").startsWith("local-")) {
    return "Local transcription is taking longer than usual";
  }
  return "The transcription provider is taking longer than usual";
};

export const useAudioRecording = (toast, options = {}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [progress, setProgress] = useState(INITIAL_PROGRESS);
  const [jobs, setJobs] = useState([]);
  const audioManagerRef = useRef(null);
  const activeSessionRef = useRef(null);
  const sessionsByIdRef = useRef(new Map());
  const jobsBySessionIdRef = useRef(new Map());
  const nextJobIdRef = useRef(0);
  const recordingSessionIdRef = useRef(null);
  const latestProgressRef = useRef(INITIAL_PROGRESS);
  const sessionStartedAtRef = useRef(null);
  const stageStartedAtRef = useRef(null);
  const recordingStartedAtRef = useRef(null);
  const progressResetTimerRef = useRef(null);
  const recordingOperationQueueRef = useRef(null);
  const deliveryCommitCountRef = useRef(0);
  if (!recordingOperationQueueRef.current) {
    recordingOperationQueueRef.current = createRecordingOperationQueue();
  }
  const { onToggle } = options;

  const clearProgressResetTimer = useCallback(() => {
    if (progressResetTimerRef.current) {
      clearTimeout(progressResetTimerRef.current);
      progressResetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    latestProgressRef.current = progress;
  }, [progress]);

  const resetProgress = useCallback(() => {
    clearProgressResetTimer();
    sessionStartedAtRef.current = null;
    stageStartedAtRef.current = null;
    recordingStartedAtRef.current = null;
    setProgress(INITIAL_PROGRESS);
  }, [clearProgressResetTimer]);

  const normalizeTriggerPayload = useCallback((payload = {}) => {
    return normalizeTriggerPayloadBase(payload, { createSessionId: createSessionIdBase });
  }, []);

  const getNextJobId = useCallback(() => {
    nextJobIdRef.current += 1;
    return nextJobIdRef.current;
  }, []);

  const syncJobs = useCallback(() => {
    const values = [...jobsBySessionIdRef.current.values()];
    values.sort((a, b) => (a.jobId || 0) - (b.jobId || 0));
    setJobs(values);
  }, []);

  const upsertJob = useCallback(
    (sessionId, patch = {}) => {
      const existing = jobsBySessionIdRef.current.get(sessionId);
      const jobId = existing?.jobId ?? getNextJobId();
      const next = { sessionId, jobId, status: "queued", ...existing, ...patch };
      jobsBySessionIdRef.current.set(sessionId, next);
      syncJobs();
      return next;
    },
    [getNextJobId, syncJobs]
  );

  const removeJob = useCallback(
    (sessionId) => {
      jobsBySessionIdRef.current.delete(sessionId);
      syncJobs();
    },
    [syncJobs]
  );

  const updateStage = useMemo(
    () =>
      createStageUpdater({
        audioManagerRef,
        clearProgressResetTimer,
        jobsBySessionIdRef,
        latestProgressRef,
        progressResetTimerRef,
        recordingStartedAtRef,
        resetProgress,
        sessionStartedAtRef,
        stageStartedAtRef,
        setProgress,
      }),
    [clearProgressResetTimer, resetProgress]
  );

  const performStartRecording = useMemo(
    () =>
      createStartRecordingHandler({
        activeSessionRef,
        audioManagerRef,
        normalizeTriggerPayload,
        recordingSessionIdRef,
        recordingStartedAtRef,
        removeJob,
        sessionStartedAtRef,
        sessionsByIdRef,
        updateStage,
        upsertJob,
        playStartCue,
      }),
    [normalizeTriggerPayload, removeJob, updateStage, upsertJob]
  );

  const performStopRecording = useMemo(
    () =>
      createStopRecordingHandler({
        activeSessionRef,
        audioManagerRef,
        latestProgressRef,
        normalizeTriggerPayload,
        recordingSessionIdRef,
        upsertJob,
      }),
    [normalizeTriggerPayload, upsertJob]
  );

  const startRecording = useCallback(
    (payload = {}) => recordingOperationQueueRef.current.run(() => performStartRecording(payload)),
    [performStartRecording]
  );

  const stopRecording = useCallback(
    (payload = {}) => {
      audioManagerRef.current?.cancelStreamingStartup?.();
      return recordingOperationQueueRef.current.run(() => performStopRecording(payload));
    },
    [performStopRecording]
  );

  const toggleRecording = useCallback(
    (payload = {}) => {
      if (audioManagerRef.current?.cancelStreamingStartup?.()) {
        return Promise.resolve(false);
      }
      return recordingOperationQueueRef.current.run(async () => {
        if (!audioManagerRef.current) return false;
        const currentState = audioManagerRef.current.getState();
        if (!currentState.isRecording) {
          return await performStartRecording(payload);
        }
        return await performStopRecording(payload);
      });
    },
    [performStartRecording, performStopRecording]
  );

  const cancelProcessing = useCallback(() => {
    if (
      deliveryCommitCountRef.current > 0 ||
      !["transcribing", "cleaning"].includes(latestProgressRef.current?.stage)
    ) {
      return false;
    }
    const cancelled = audioManagerRef.current?.cancelProcessing() || false;
    if (!cancelled) {
      return false;
    }
    activeSessionRef.current = null;
    sessionsByIdRef.current.clear();
    jobsBySessionIdRef.current.clear();
    setJobs([]);
    updateStage("cancelled", { message: "Processing cancelled", canCancel: false });
    void playCancelCue();
    return true;
  }, [updateStage]);

  const routeToggleDictation = useCallback(
    (payload = {}) => {
      const managerState = audioManagerRef.current?.getState?.();
      if (managerState?.isProcessing || latestProgressRef.current?.canCancel) {
        return Promise.resolve(false);
      }
      return toggleRecording(payload);
    },
    [toggleRecording]
  );

  const routeStartDictation = useCallback(
    (payload = {}) => {
      const managerState = audioManagerRef.current?.getState?.();
      if (
        deliveryCommitCountRef.current > 0 ||
        managerState?.isProcessing ||
        latestProgressRef.current?.canCancel
      ) {
        return Promise.resolve(false);
      }
      return startRecording(payload);
    },
    [startRecording]
  );

  useEffect(() => {
    audioManagerRef.current = new AudioManager();

    const isE2E =
      typeof window !== "undefined" &&
      (() => {
        try {
          return new URLSearchParams(window.location.search).get("e2e") === "true";
        } catch {
          return false;
        }
      })();

    const handleTranscriptionComplete = createTranscriptionCompleteHandler({
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
      deliveryCommitCountRef,
    });

    audioManagerRef.current.setCallbacks(
      createAudioManagerCallbacks({
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
        onTranscriptionComplete: handleTranscriptionComplete,
        playErrorCue,
        playStopCue,
      })
    );

    const disposeE2E = installE2EHelpers({
      enabled: isE2E,
      activeSessionRef,
      audioManagerRef,
      latestProgressRef,
      normalizeTriggerPayload,
      onTranscriptionComplete: handleTranscriptionComplete,
      updateStage,
    });

    audioManagerRef.current.warmupStreamingConnection();

    const disposeToggle = window.electronAPI.onToggleDictation((payload) => {
      void routeToggleDictation(payload);
      onToggle?.();
    });

    const disposeStart = window.electronAPI.onStartDictation?.((payload) => {
      void routeStartDictation(payload);
      onToggle?.();
    });

    const disposeStop = window.electronAPI.onStopDictation?.((payload) => {
      void stopRecording(payload);
      onToggle?.();
    });

    const disposeCancelProcessing = window.electronAPI.onCancelDictationProcessing?.(() => {
      cancelProcessing();
    });

    const handleNoAudioDetected = () => {
      updateStage("error", { message: "No audio detected" });
      void playErrorCue();
      toast({
        title: "No Audio Detected",
        description: "The recording contained no detectable audio. Please try again.",
        variant: "default",
      });
    };

    const disposeNoAudio = window.electronAPI.onNoAudioDetected?.(handleNoAudioDetected);

    return () => {
      disposeToggle?.();
      disposeStart?.();
      disposeStop?.();
      disposeCancelProcessing?.();
      disposeNoAudio?.();
      disposeE2E?.();
      clearProgressResetTimer();
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, [
    clearProgressResetTimer,
    cancelProcessing,
    normalizeTriggerPayload,
    onToggle,
    removeJob,
    routeStartDictation,
    stopRecording,
    toast,
    routeToggleDictation,
    upsertJob,
    updateStage,
  ]);

  useEffect(() => {
    if (progress.stage === "idle") {
      return;
    }

    const timer = setInterval(() => {
      const now = Date.now();
      setProgress((prev) => {
        if (prev.stage === "idle") {
          return prev;
        }

        const elapsedMs = Math.max(0, now - (sessionStartedAtRef.current || now));
        const stageElapsedMs = Math.max(0, now - (stageStartedAtRef.current || now));
        const recordedMs =
          prev.stage === "listening" && recordingStartedAtRef.current
            ? Math.max(0, now - recordingStartedAtRef.current)
            : prev.recordedMs;
        const slowStage = prev.stage === "transcribing" || prev.stage === "cleaning";
        const shouldMarkSlow =
          slowStage && stageElapsedMs >= SLOW_STAGE_THRESHOLD_MS && prev.transportRetrying !== true;

        return {
          ...prev,
          elapsedMs,
          stageElapsedMs,
          recordedMs,
          ...(shouldMarkSlow
            ? {
                isSlow: true,
                canCancel: true,
                stageLabel: prev.stage === "cleaning" ? "Still cleaning up" : "Still transcribing",
                message: prev.message || getSlowStageMessage(prev),
              }
            : {}),
        };
      });
    }, 200);

    return () => clearInterval(timer);
  }, [progress.stage]);

  const cancelRecording = async () => {
    const startupCancelled = audioManagerRef.current?.cancelStreamingStartup?.() || false;
    if (audioManagerRef.current?.getState().isStreaming) {
      return await stopRecording({ stopReason: "manual", stopSource: "cancel-control" });
    }

    const sessionId = recordingSessionIdRef.current || activeSessionRef.current?.sessionId || null;
    activeSessionRef.current = null;
    recordingSessionIdRef.current = null;
    if (sessionId) {
      sessionsByIdRef.current.delete(sessionId);
      removeJob(sessionId);
    }
    updateStage("cancelled", { message: "Recording cancelled" });
    if (audioManagerRef.current) {
      const cancelled = audioManagerRef.current.cancelRecording();
      if (cancelled || startupCancelled) {
        void playCancelCue();
      }
      return cancelled || startupCancelled;
    }
    return false;
  };

  const toggleListening = async (payload = {}) => {
    const managerState = audioManagerRef.current?.getState?.();
    if (managerState?.isProcessing || latestProgressRef.current?.canCancel) {
      return;
    }
    const outputMode = payload?.outputMode === "clipboard" ? "clipboard" : "insert";
    if (!isRecording && (!isProcessing || outputMode === "clipboard")) {
      await toggleRecording(payload);
    } else if (isRecording) {
      await toggleRecording(payload);
    }
  };

  const warmupStreaming = () => {
    audioManagerRef.current?.warmupStreamingConnection();
  };

  return {
    isRecording,
    isProcessing,
    isStreaming,
    transcript,
    partialTranscript,
    progress,
    jobs,
    startRecording,
    stopRecording,
    cancelRecording,
    cancelProcessing,
    toggleListening,
    warmupStreaming,
  };
};
