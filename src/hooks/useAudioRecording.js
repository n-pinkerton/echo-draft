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
  const audioManagerRef = useRef(null);
  const activeSessionRef = useRef(null);
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

  const updateStage = useCallback(
    (stage, patch = {}) => {
      const normalizedStage = STAGE_META[stage] ? stage : "idle";
      const now = Date.now();

      if (!sessionStartedAtRef.current) {
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
        };
      });

      if (TERMINAL_STAGES.has(normalizedStage)) {
        progressResetTimerRef.current = setTimeout(() => {
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
      if (currentState.isRecording || currentState.isProcessing) {
        return false;
      }

      const session = normalizeTriggerPayload(payload);

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

      const didStart = audioManagerRef.current.shouldUseStreaming()
        ? await audioManagerRef.current.startStreamingRecording()
        : await audioManagerRef.current.startRecording();

      if (didStart) {
        activeSessionRef.current = session;
        sessionStartedAtRef.current = Date.now();
        recordingStartedAtRef.current = sessionStartedAtRef.current;
        updateStage("listening", {
          outputMode: session.outputMode,
          sessionId: session.sessionId,
          generatedChars: 0,
          generatedWords: 0,
          message: session.outputMode === "clipboard" ? "Clipboard mode" : null,
        });
        void playStartCue();
      }

      return didStart;
    },
    [normalizeTriggerPayload, updateStage]
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

      updateStage("transcribing", {
        stageProgress: null,
      });

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
    [normalizeTriggerPayload, updateStage]
  );

  useEffect(() => {
    audioManagerRef.current = new AudioManager();

    audioManagerRef.current.setCallbacks({
      onStateChange: ({ isRecording, isProcessing, isStreaming }) => {
        setIsRecording(isRecording);
        setIsProcessing(isProcessing);
        setIsStreaming(isStreaming ?? false);

        if (!isStreaming) {
          setPartialTranscript("");
        }

        if (!isRecording && isProcessing) {
          setProgress((prev) => {
            if (prev.stage === "listening") {
              return {
                ...prev,
                stage: "transcribing",
                stageLabel: STAGE_META.transcribing.label,
                stageProgress: null,
                overallProgress: STAGE_META.transcribing.overallProgress,
              };
            }
            return prev;
          });
        }
      },
      onError: (error) => {
        activeSessionRef.current = null;
        updateStage("error", {
          message: error.description || error.message || "An unknown error occurred",
        });

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

        if (event.stage) {
          updateStage(event.stage, {
            stageLabel: event.stageLabel,
            stageProgress: event.stageProgress,
            overallProgress: event.overallProgress,
            generatedChars: event.generatedChars,
            generatedWords: event.generatedWords,
            provider: event.provider,
            model: event.model,
            message: event.message,
          });
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
      onTranscriptionComplete: async (result) => {
        if (!result.success) {
          updateStage("error", { message: "Transcription did not complete." });
          return;
        }

        setTranscript(result.text);
        const session = activeSessionRef.current || normalizeTriggerPayload();
        activeSessionRef.current = null;

        let pasteSucceeded = false;
        let pasteMs = null;

        if (session.outputMode === "insert") {
          updateStage("inserting", {
            outputMode: session.outputMode,
            sessionId: session.sessionId,
          });

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
            title: "Copied to Clipboard",
            description: "Dictation finished. Paste where you want the text.",
            duration: 2500,
          });
        }

        updateStage("saving", {
          outputMode: session.outputMode,
          sessionId: session.sessionId,
        });

        const saveStart = performance.now();
        const baseTimings = {
          ...(result.timings || {}),
          pasteDurationMs: pasteMs,
        };
        const latestProgress = latestProgressRef.current || {};
        const provider = latestProgress.provider || result.source || "";
        const model = latestProgress.model || "";

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
        const totalDurationMs = sessionStartedAtRef.current
          ? Math.max(0, Date.now() - sessionStartedAtRef.current)
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

        updateStage("done", {
          outputMode: session.outputMode,
          sessionId: session.sessionId,
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
          elapsedMs: sessionStartedAtRef.current
            ? Math.max(0, Date.now() - sessionStartedAtRef.current)
            : prev.elapsedMs,
          recordedMs: prev.recordedMs,
          message: saveSucceeded && saveMs > 0 ? `Saved in ${saveMs}ms` : prev.message,
        }));

        audioManagerRef.current.warmupStreamingConnection();
      },
    });

    audioManagerRef.current.warmupStreamingConnection();

    const handleToggle = async (payload = {}) => {
      if (!audioManagerRef.current) return;
      const currentState = audioManagerRef.current.getState();

      if (!currentState.isRecording && !currentState.isProcessing) {
        await performStartRecording(payload);
      } else if (currentState.isRecording) {
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
    };
  }, [
    clearProgressResetTimer,
    normalizeTriggerPayload,
    onToggle,
    performStartRecording,
    performStopRecording,
    toast,
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

  const startRecording = async () => {
    return performStartRecording();
  };

  const stopRecording = async () => {
    return performStopRecording();
  };

  const cancelRecording = async () => {
    activeSessionRef.current = null;
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
    updateStage("cancelled", { message: "Processing cancelled" });
    if (audioManagerRef.current) {
      return audioManagerRef.current.cancelProcessing();
    }
    return false;
  };

  const toggleListening = async () => {
    if (!isRecording && !isProcessing) {
      await startRecording();
    } else if (isRecording) {
      await stopRecording();
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
    startRecording,
    stopRecording,
    cancelRecording,
    cancelProcessing,
    toggleListening,
    warmupStreaming,
  };
};
