import { useState, useEffect, useRef, useCallback } from "react";
import AudioManager from "../helpers/audioManager";
import logger from "../utils/logger";
import { playStartCue, playStopCue } from "../utils/dictationCues";

const STAGE_META = {
  idle: { label: "Ready", overallProgress: 0 },
  listening: { label: "Listening", overallProgress: 0.1 },
  transcribing: { label: "Transcribing", overallProgress: 0.45 },
  cleaning: { label: "Cleaning up", overallProgress: 0.7 },
  inserting: { label: "Inserting", overallProgress: 0.85 },
  saving: { label: "Saving", overallProgress: 0.93 },
  done: { label: "Done", overallProgress: 1 },
  error: { label: "Error", overallProgress: 1 },
  cancelled: { label: "Cancelled", overallProgress: 1 },
};

const TERMINAL_STAGES = new Set(["done", "error", "cancelled"]);

const INITIAL_PROGRESS = {
  stage: "idle",
  stageLabel: STAGE_META.idle.label,
  stageProgress: null,
  overallProgress: STAGE_META.idle.overallProgress,
  elapsedMs: 0,
  recordedMs: 0,
  generatedChars: 0,
  generatedWords: 0,
  outputMode: "insert",
  sessionId: null,
  jobId: null,
  provider: null,
  model: null,
  message: null,
};

const countWords = (text) => {
  if (!text || typeof text !== "string") return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
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

  const createSessionId = useCallback(() => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }, []);

  const normalizeTriggerPayload = useCallback(
    (payload = {}) => {
      const outputMode = payload?.outputMode === "clipboard" ? "clipboard" : "insert";
      const sessionId =
        typeof payload?.sessionId === "string" && payload.sessionId.trim()
          ? payload.sessionId
          : createSessionId();
      const insertionTarget =
        payload?.insertionTarget && typeof payload.insertionTarget === "object"
          ? payload.insertionTarget
          : null;
      return { outputMode, sessionId, insertionTarget };
    },
    [createSessionId]
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

  const updateStage = useCallback(
    (stage, patch = {}) => {
      const normalizedStage = STAGE_META[stage] ? stage : "idle";
      const now = Date.now();

      const previousSessionId = latestProgressRef.current?.sessionId;
      const nextSessionId = patch.sessionId || previousSessionId;
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
            patch.overallProgress !== undefined
              ? patch.overallProgress
              : defaultMeta.overallProgress,
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
    },
    [clearProgressResetTimer, resetProgress]
  );

  const performStartRecording = useCallback(
    async (payload = {}) => {
      if (!audioManagerRef.current) {
        return false;
      }

      const currentState = audioManagerRef.current.getState();
      const session = normalizeTriggerPayload(payload);
      if (currentState.isRecording) {
        return false;
      }
      if (currentState.isProcessing && session.outputMode !== "clipboard") {
        return false;
      }

      const job = upsertJob(session.sessionId, {
        outputMode: session.outputMode,
        status: "recording",
        startedAt: Date.now(),
        recordedMs: null,
        provider: null,
        model: null,
      });
      sessionsByIdRef.current.set(session.sessionId, session);
      recordingSessionIdRef.current = session.sessionId;

      if (session.outputMode === "insert" && window.electronAPI?.captureInsertionTarget) {
        try {
          const captureResult = await window.electronAPI.captureInsertionTarget();
          if (captureResult?.success && captureResult?.target?.hwnd) {
            session.insertionTarget = captureResult.target;
          }
        } catch (error) {
          logger.warn("Failed to capture insertion target", { error: error?.message }, "clipboard");
        }
      }

      const shouldForceNonStreaming =
        currentState.isProcessing && session.outputMode === "clipboard";
      const recordingContext = {
        sessionId: session.sessionId,
        jobId: job.jobId,
        outputMode: session.outputMode,
      };

      const didStart =
        !shouldForceNonStreaming && audioManagerRef.current.shouldUseStreaming()
          ? await audioManagerRef.current.startStreamingRecording(recordingContext)
          : await audioManagerRef.current.startRecording(recordingContext);

      if (didStart) {
        activeSessionRef.current = session;
        sessionStartedAtRef.current = Date.now();
        recordingStartedAtRef.current = sessionStartedAtRef.current;
        updateStage("listening", {
          outputMode: session.outputMode,
          sessionId: session.sessionId,
          jobId: job.jobId,
          generatedChars: 0,
          generatedWords: 0,
          message: session.outputMode === "clipboard" ? "Clipboard mode" : null,
        });
        void playStartCue();
      } else {
        sessionsByIdRef.current.delete(session.sessionId);
        recordingSessionIdRef.current = null;
        removeJob(session.sessionId);
      }

      return didStart;
    },
    [normalizeTriggerPayload, removeJob, updateStage, upsertJob]
  );

  const performStopRecording = useCallback(
    async (payload = {}) => {
      if (!audioManagerRef.current) {
        return false;
      }

      const currentState = audioManagerRef.current.getState();
      if (!currentState.isRecording) {
        return false;
      }

      if (!activeSessionRef.current) {
        activeSessionRef.current = normalizeTriggerPayload(payload);
      }

      const session = activeSessionRef.current;
      if (session?.sessionId) {
        const recordedMsSnapshot =
          typeof latestProgressRef.current?.recordedMs === "number" &&
          latestProgressRef.current.recordedMs > 0
            ? Math.round(latestProgressRef.current.recordedMs)
            : null;
        upsertJob(session.sessionId, {
          status:
            currentState.isProcessing && session.outputMode === "clipboard"
              ? "queued"
              : "processing",
          ...(recordedMsSnapshot !== null ? { recordedMs: recordedMsSnapshot } : {}),
          stoppedAt: Date.now(),
        });
      }
      recordingSessionIdRef.current = null;

      if (currentState.isStreaming) {
        void playStopCue();
        return await audioManagerRef.current.stopStreamingRecording();
      }

      const didStop = audioManagerRef.current.stopRecording();
      if (didStop) {
        void playStopCue();
      }

      return didStop;
    },
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

    const handleTranscriptionComplete = async (result) => {
      const contextSessionId =
        typeof result?.context?.sessionId === "string" && result.context.sessionId.trim()
          ? result.context.sessionId.trim()
          : null;

      const fallbackSession = contextSessionId
        ? normalizeTriggerPayload(result?.context || {})
        : activeSessionRef.current || normalizeTriggerPayload(result?.context || {});
      const resolvedSessionId = contextSessionId || fallbackSession.sessionId;
      const storedSession = resolvedSessionId
        ? sessionsByIdRef.current.get(resolvedSessionId)
        : null;
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
        pasteSucceeded = await audioManagerRef.current.safePaste(result.text, pasteOptions);
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
          await window.electronAPI?.writeClipboard?.(result.text);
        } catch (error) {
          logger.warn("Failed to write clipboard", { error: error?.message }, "clipboard");
        }

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
        typeof job?.recordedMs === "number" && job.recordedMs > 0
          ? Math.round(job.recordedMs)
          : null;
      const baseTimings = {
        ...(result.timings || {}),
        ...(recordDurationMs !== null ? { recordDurationMs } : {}),
        pasteDurationMs: pasteMs,
      };
      const provider = job?.provider || result.source || "";
      const model = job?.model || "";

      const saveResult = await audioManagerRef.current.saveTranscription({
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
        typeof job?.startedAt === "number" && job.startedAt > 0
          ? Math.max(0, Date.now() - job.startedAt)
          : null;

      if (saveSucceeded && savedId && window.electronAPI?.patchTranscriptionMeta) {
        try {
          await window.electronAPI.patchTranscriptionMeta(savedId, {
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

      if (result.source === "openai" && localStorage.getItem("useLocalWhisper") === "true") {
        toast({
          title: "Fallback Mode",
          description: "Local Whisper failed. Used OpenAI API instead.",
          variant: "default",
        });
      }

      if (result.source === "openwhispr" && result.limitReached) {
        window.electronAPI?.notifyLimitReached?.({
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

      audioManagerRef.current.warmupStreamingConnection();
    };

    audioManagerRef.current.setCallbacks({
      onStateChange: ({ isRecording, isProcessing, isStreaming }) => {
        setIsRecording(isRecording);
        setIsProcessing(isProcessing);
        setIsStreaming(isStreaming ?? false);

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

        const contextSessionId =
          typeof event?.context?.sessionId === "string" ? event.context.sessionId : null;
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
          const jobPatch = {
            status: nextStatus,
          };
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
        }));
      },
      onPartialTranscript: (text) => {
        setPartialTranscript(text);
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
      onTranscriptionComplete: handleTranscriptionComplete,
    });

    if (isE2E && typeof window !== "undefined") {
      window.__openwhisprE2E = {
        getProgress: () => latestProgressRef.current,
        setStage: (stage, patch = {}) => {
          updateStage(stage, patch);
          return latestProgressRef.current;
        },
        setActiveSession: (payload = {}) => {
          activeSessionRef.current = normalizeTriggerPayload(payload);
          return activeSessionRef.current;
        },
        simulateTranscriptionComplete: async (resultPatch = {}, sessionPatch = {}) => {
          const session = normalizeTriggerPayload(sessionPatch);
          activeSessionRef.current = session;
          const text =
            typeof resultPatch.text === "string"
              ? resultPatch.text
              : String(resultPatch.text ?? "");
          const rawText =
            typeof resultPatch.rawText === "string"
              ? resultPatch.rawText
              : resultPatch.rawText == null
                ? null
                : String(resultPatch.rawText);

          return handleTranscriptionComplete({
            success: true,
            text,
            rawText: rawText || text,
            source: resultPatch.source || "e2e",
            timings: resultPatch.timings || {},
            limitReached: Boolean(resultPatch.limitReached),
            wordsUsed: resultPatch.wordsUsed,
            wordsRemaining: resultPatch.wordsRemaining,
          });
        },
        isLikelyDictionaryPromptEcho: (transcribedText = "", dictionaryEntries = []) => {
          const manager = audioManagerRef.current;
          if (!manager?.isLikelyDictionaryPromptEcho) {
            return false;
          }
          return manager.isLikelyDictionaryPromptEcho(transcribedText, dictionaryEntries);
        },
      };
    }

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
      clearProgressResetTimer();
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
      if (isE2E && typeof window !== "undefined" && window.__openwhisprE2E) {
        delete window.__openwhisprE2E;
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
