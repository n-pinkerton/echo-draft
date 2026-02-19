import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import AudioManager from "../helpers/audioManager";
import { playStartCue, playStopCue } from "../utils/dictationCues";
import { INITIAL_PROGRESS } from "./audioRecording/stages";
import { createSessionId as createSessionIdBase, normalizeTriggerPayload as normalizeTriggerPayloadBase } from "./audioRecording/triggerPayload";
import { createAudioManagerCallbacks } from "./audioRecording/audioManagerCallbacks";
import { installE2EHelpers } from "./audioRecording/e2eHelpers";
import { createStartRecordingHandler, createStopRecordingHandler } from "./audioRecording/recordingHandlers";
import { createStageUpdater } from "./audioRecording/stageUpdater";
import { createTranscriptionCompleteHandler } from "./audioRecording/transcriptionCompleteHandler";

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
  const recordingStartedAtRef = useRef(null);
  const progressResetTimerRef = useRef(null);
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
    recordingStartedAtRef.current = null;
    setProgress(INITIAL_PROGRESS);
  }, [clearProgressResetTimer]);

  const normalizeTriggerPayload = useCallback(
    (payload = {}) => {
      return normalizeTriggerPayloadBase(payload, { createSessionId: createSessionIdBase });
    },
    []
  );

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
        playStopCue,
      }),
    [normalizeTriggerPayload, upsertJob]
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

    const handleToggle = async (payload = {}) => {
      if (!audioManagerRef.current) return;
      const currentState = audioManagerRef.current.getState();

      if (!currentState.isRecording) {
        await performStartRecording(payload);
      } else {
        await performStopRecording(payload);
      }
    };

    const handleStart = async (payload = {}) => {
      await performStartRecording(payload);
    };

    const handleStop = async (payload = {}) => {
      await performStopRecording(payload);
    };

    const disposeToggle = window.electronAPI.onToggleDictation((payload) => {
      handleToggle(payload);
      onToggle?.();
    });

    const disposeStart = window.electronAPI.onStartDictation?.((payload) => {
      handleStart(payload);
      onToggle?.();
    });

    const disposeStop = window.electronAPI.onStopDictation?.((payload) => {
      handleStop(payload);
      onToggle?.();
    });

    const handleNoAudioDetected = () => {
      updateStage("error", { message: "No audio detected" });
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
      disposeNoAudio?.();
      disposeE2E?.();
      clearProgressResetTimer();
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, [
    clearProgressResetTimer,
    normalizeTriggerPayload,
    onToggle,
    performStartRecording,
    performStopRecording,
    removeJob,
    toast,
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
        const recordedMs =
          prev.stage === "listening" && recordingStartedAtRef.current
            ? Math.max(0, now - recordingStartedAtRef.current)
            : prev.recordedMs;

        return {
          ...prev,
          elapsedMs,
          recordedMs,
        };
      });
    }, 200);

    return () => clearInterval(timer);
  }, [progress.stage]);

  const startRecording = async (payload = {}) => {
    return performStartRecording(payload);
  };

  const stopRecording = async (payload = {}) => {
    return performStopRecording(payload);
  };

  const cancelRecording = async () => {
    const sessionId = recordingSessionIdRef.current || activeSessionRef.current?.sessionId || null;
    activeSessionRef.current = null;
    recordingSessionIdRef.current = null;
    if (sessionId) {
      sessionsByIdRef.current.delete(sessionId);
      removeJob(sessionId);
    }
    updateStage("cancelled", { message: "Recording cancelled" });
    if (audioManagerRef.current) {
      const state = audioManagerRef.current.getState();
      if (state.isStreaming) {
        return await audioManagerRef.current.stopStreamingRecording();
      }
      return audioManagerRef.current.cancelRecording();
    }
    return false;
  };

  const cancelProcessing = () => {
    activeSessionRef.current = null;
    sessionsByIdRef.current.clear();
    jobsBySessionIdRef.current.clear();
    setJobs([]);
    updateStage("cancelled", { message: "Processing cancelled" });
    if (audioManagerRef.current) {
      return audioManagerRef.current.cancelProcessing();
    }
    return false;
  };

  const toggleListening = async (payload = {}) => {
    const outputMode = payload?.outputMode === "clipboard" ? "clipboard" : "insert";
    if (!isRecording && (!isProcessing || outputMode === "clipboard")) {
      await startRecording(payload);
    } else if (isRecording) {
      await stopRecording(payload);
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
