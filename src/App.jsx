import React, { useEffect, useLayoutEffect, useMemo } from "react";
import "./index.css";
import { useToast } from "./components/ui/toastContext";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useAuth } from "./hooks/useAuth";
import { useLocalStorage } from "./hooks/useLocalStorage";
import RecordingIndicator from "./components/ui/RecordingIndicator";
import { DICTATION_FEEDBACK_STORAGE_KEYS } from "./utils/dictationCues";
import { useWindowsPushToTalkStatus } from "./hooks/useWindowsPushToTalkStatus";

const serializeBoolean = (value) => String(value);
const deserializeBoolean = (value) => value !== "false";

export default function App() {
  const { toast, dismiss, toastCount = 0, toastViewportSize = "default" } = useToast();
  const { isSignedIn } = useAuth();
  const [recordingIndicatorEnabled] = useLocalStorage(
    DICTATION_FEEDBACK_STORAGE_KEYS.recordingIndicatorEnabled,
    true,
    { serialize: serializeBoolean, deserialize: deserializeBoolean }
  );
  const [longRecordingReminderEnabled] = useLocalStorage(
    DICTATION_FEEDBACK_STORAGE_KEYS.longRecordingReminderEnabled,
    true,
    { serialize: serializeBoolean, deserialize: deserializeBoolean }
  );

  useLayoutEffect(() => {
    // Keep the transparent surface in place while the final hide IPC crosses
    // the renderer/main-process boundary; otherwise one empty frame can flash.
    document.documentElement.classList.add("dictation-window-surface");
    return () => document.documentElement.classList.remove("dictation-window-surface");
  }, []);

  useEffect(() => {
    const unsubscribeFallback = window.electronAPI?.onHotkeyFallbackUsed?.((data) => {
      window.electronAPI?.updateTrayStatus?.({
        stage: "done",
        stageLabel: "Hotkey Changed",
        message: data.message || "",
      });
      toast({
        title: "Hotkey Changed",
        description: data.message,
        duration: 8000,
      });
    });

    const unsubscribeFailed = window.electronAPI?.onHotkeyRegistrationFailed?.((_data) => {
      window.electronAPI?.updateTrayStatus?.({
        stage: "error",
        stageLabel: "Hotkey Unavailable",
        message: "Set a different hotkey in Settings.",
      });
      toast({
        title: "Hotkey Unavailable",
        description: `Could not register hotkey. Please set a different hotkey in Settings.`,
        duration: 10000,
      });
    });

    return () => {
      unsubscribeFallback?.();
      unsubscribeFailed?.();
    };
  }, [toast]);

  useWindowsPushToTalkStatus({ toast, dismiss, updateTray: true });

  const {
    isRecording,
    isProcessing,
    progress,
    jobs,
    transcript,
    partialTranscript,
    warmupStreaming,
  } = useAudioRecording(toast);

  const queuedAheadCount = useMemo(
    () =>
      Array.isArray(jobs)
        ? jobs.filter((job) => job?.status === "processing" || job?.status === "queued").length
        : 0,
    [jobs]
  );
  const queuedWaitingCount = Math.max(0, queuedAheadCount - (!isRecording && isProcessing ? 1 : 0));

  // Trigger streaming warmup when user signs in (covers first-time account creation)
  useEffect(() => {
    if (isSignedIn) {
      warmupStreaming();
    }
  }, [isSignedIn, warmupStreaming]);

  const trayStatus = useMemo(() => {
    const visibleJobs = Array.isArray(jobs)
      ? jobs.filter((job) => job && typeof job === "object" && job.status !== "done")
      : [];
    const transcriptToCopy =
      typeof partialTranscript === "string" && partialTranscript.trim()
        ? partialTranscript
        : transcript;

    return {
      stage: progress?.stage || "idle",
      stageLabel: progress?.stageLabel || "Ready",
      message: progress?.message || "",
      recordedMs: typeof progress?.recordedMs === "number" ? progress.recordedMs : null,
      elapsedMs: typeof progress?.elapsedMs === "number" ? progress.elapsedMs : null,
      stageElapsedMs: typeof progress?.stageElapsedMs === "number" ? progress.stageElapsedMs : null,
      generatedWords: typeof progress?.generatedWords === "number" ? progress.generatedWords : null,
      jobCount: visibleJobs.length,
      queuedJobCount: queuedAheadCount,
      waitingJobCount: queuedWaitingCount,
      hasTranscript: Boolean(transcriptToCopy && transcriptToCopy.trim()),
      transcriptToCopy: typeof transcriptToCopy === "string" ? transcriptToCopy : "",
      outputMode: progress?.outputMode === "clipboard" ? "clipboard" : "insert",
      provider: progress?.provider || "",
      model: progress?.model || "",
      isSlow: progress?.isSlow === true,
      canCancel: progress?.canCancel === true,
      transportAttempt:
        typeof progress?.transportAttempt === "number" ? progress.transportAttempt : null,
      transportRetrying: progress?.transportRetrying === true,
      isRecording,
      isProcessing,
    };
  }, [
    jobs,
    partialTranscript,
    progress,
    transcript,
    isRecording,
    isProcessing,
    queuedAheadCount,
    queuedWaitingCount,
  ]);

  useEffect(() => {
    window.electronAPI?.updateTrayStatus?.(trayStatus);
  }, [trayStatus]);

  const isListening = progress?.stage === "listening";
  const shouldShowRecordingIndicator = recordingIndicatorEnabled && isListening;
  const hasVisibleToast = toastCount > 0;
  const shouldShowDictationWindow = shouldShowRecordingIndicator || hasVisibleToast;
  const dictationWindowSize = hasVisibleToast
    ? toastViewportSize === "compact"
      ? "WITH_COMPACT_TOAST"
      : "WITH_TOAST"
    : "RECORDING_INDICATOR";

  useEffect(() => {
    if (shouldShowDictationWindow) {
      // The main process applies the final size and presents the window as one
      // operation, avoiding a visible 260px collapse before toast expansion.
      void window.electronAPI?.showRecordingIndicator?.(dictationWindowSize);
    } else {
      void window.electronAPI?.hideWindow?.();
    }
  }, [dictationWindowSize, shouldShowDictationWindow]);

  useEffect(() => {
    return () => {
      window.electronAPI?.updateTrayStatus?.({
        stage: "idle",
        stageLabel: "Ready",
        message: "",
        transcriptToCopy: "",
      });
    };
  }, []);

  if (!shouldShowRecordingIndicator) {
    return null;
  }

  return (
    <RecordingIndicator
      recordedMs={progress?.recordedMs || 0}
      longRecordingReminderEnabled={longRecordingReminderEnabled}
      queuedAheadCount={queuedAheadCount}
      outputMode={progress?.outputMode}
    />
  );
}
