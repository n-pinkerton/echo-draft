import { useState, useEffect, useRef, useCallback } from "react";
import AudioManager from "../helpers/audioManager";
import logger from "../utils/logger";
import { playStartCue, playStopCue } from "../utils/dictationCues";

export const useAudioRecording = (toast, options = {}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const audioManagerRef = useRef(null);
  const activeSessionRef = useRef(null);
  const { onToggle } = options;

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
      return { outputMode, sessionId };
    },
    [createSessionId]
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
      const didStart = audioManagerRef.current.shouldUseStreaming()
        ? await audioManagerRef.current.startStreamingRecording()
        : await audioManagerRef.current.startRecording();

      if (didStart) {
        activeSessionRef.current = session;
        void playStartCue();
      }

      return didStart;
    },
    [normalizeTriggerPayload]
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

      if (currentState.isStreaming) {
        void playStopCue(); // streaming stop finalization is async, play cue immediately on stop action
        return await audioManagerRef.current.stopStreamingRecording();
      }

      const didStop = audioManagerRef.current.stopRecording();

      if (didStop) {
        void playStopCue();
      }

      return didStop;
    },
    [normalizeTriggerPayload]
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
      },
      onError: (error) => {
        activeSessionRef.current = null;
        // Provide specific titles for cloud error codes
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
      onPartialTranscript: (text) => {
        setPartialTranscript(text);
      },
      onTranscriptionComplete: async (result) => {
        if (result.success) {
          setTranscript(result.text);
          const session = activeSessionRef.current || normalizeTriggerPayload();
          activeSessionRef.current = null;

          try {
            await window.electronAPI?.writeClipboard?.(result.text);
          } catch (error) {
            logger.warn("Failed to write clipboard", { error: error?.message }, "clipboard");
          }

          let pasteSucceeded = false;
          if (session.outputMode === "insert") {
            const isStreaming = result.source?.includes("streaming");
            const pasteStart = performance.now();
            pasteSucceeded = await audioManagerRef.current.safePaste(
              result.text,
              isStreaming ? { fromStreaming: true } : {}
            );
            logger.info(
              "Paste timing",
              {
                pasteMs: Math.round(performance.now() - pasteStart),
                source: result.source,
                textLength: result.text.length,
                outputMode: session.outputMode,
                pasteSucceeded,
              },
              "streaming"
            );
          } else {
            toast({
              title: "Copied to Clipboard",
              description: "Dictation finished. Paste where you want the text.",
              duration: 2500,
            });
          }

          audioManagerRef.current.saveTranscription({
            text: result.text,
            rawText: result.rawText || result.text,
            meta: {
              sessionId: session.sessionId,
              outputMode: session.outputMode,
              status: "success",
              source: result.source,
              pasteSucceeded,
              timings: result.timings || {},
            },
          });

          if (result.source === "openai" && localStorage.getItem("useLocalWhisper") === "true") {
            toast({
              title: "Fallback Mode",
              description: "Local Whisper failed. Used OpenAI API instead.",
              variant: "default",
            });
          }

          // Cloud usage: limit reached after this transcription
          if (result.source === "openwhispr" && result.limitReached) {
            // Notify control panel to show UpgradePrompt dialog
            window.electronAPI?.notifyLimitReached?.({
              wordsUsed: result.wordsUsed,
              limit:
                result.wordsRemaining !== undefined
                  ? result.wordsUsed + result.wordsRemaining
                  : 2000,
            });
          }

          audioManagerRef.current.warmupStreamingConnection();
        }
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
      toast({
        title: "No Audio Detected",
        description: "The recording contained no detectable audio. Please try again.",
        variant: "default",
      });
    };

    const disposeNoAudio = window.electronAPI.onNoAudioDetected?.(handleNoAudioDetected);

    // Cleanup
    return () => {
      disposeToggle?.();
      disposeStart?.();
      disposeStop?.();
      disposeNoAudio?.();
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, [normalizeTriggerPayload, onToggle, performStartRecording, performStopRecording, toast]);

  const startRecording = async () => {
    return performStartRecording();
  };

  const stopRecording = async () => {
    return performStopRecording();
  };

  const cancelRecording = async () => {
    activeSessionRef.current = null;
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
    startRecording,
    stopRecording,
    cancelRecording,
    cancelProcessing,
    toggleListening,
    warmupStreaming,
  };
};
