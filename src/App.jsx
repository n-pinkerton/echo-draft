import React, { useEffect, useMemo } from "react";
import "./index.css";
import { useToast } from "./components/ui/toastContext";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useAuth } from "./hooks/useAuth";

export default function App() {
  const { toast } = useToast();
  const { isSignedIn } = useAuth();

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

    const unsubscribeWindowsPtt = window.electronAPI?.onWindowsPushToTalkUnavailable?.((data) => {
      const reason = typeof data?.reason === "string" ? data.reason : "";
      const message = typeof data?.message === "string" ? data.message : "";
      window.electronAPI?.updateTrayStatus?.({
        stage: "error",
        stageLabel: "Windows Listener Unavailable",
        message:
          message ||
          (reason === "binary_not_found"
            ? "Push-to-Talk native listener is missing."
            : "Push-to-Talk native listener is unavailable."),
      });
      toast({
        title: "Windows Key Listener Unavailable",
        description:
          message ||
          (reason === "binary_not_found"
            ? "Push-to-Talk native listener is missing. Modifier-only hotkeys may not work. Choose a non-modifier hotkey (e.g., F9) or reinstall."
            : "Push-to-Talk native listener is unavailable. Modifier-only hotkeys may not work. Choose a non-modifier hotkey (e.g., F9) or reinstall."),
        duration: 12000,
      });
    });

    return () => {
      unsubscribeFallback?.();
      unsubscribeFailed?.();
      unsubscribeWindowsPtt?.();
    };
  }, [toast]);

  const {
    isRecording,
    isProcessing,
    progress,
    jobs,
    transcript,
    partialTranscript,
    warmupStreaming,
  } = useAudioRecording(toast);

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
      generatedWords:
        typeof progress?.generatedWords === "number" ? progress.generatedWords : null,
      jobCount: visibleJobs.length,
      hasTranscript: Boolean(transcriptToCopy && transcriptToCopy.trim()),
      outputMode: progress?.outputMode === "clipboard" ? "clipboard" : "insert",
      provider: progress?.provider || "",
      model: progress?.model || "",
      isRecording,
      isProcessing,
    };
  }, [jobs, partialTranscript, progress, transcript, isRecording, isProcessing]);

  useEffect(() => {
    window.electronAPI?.updateTrayStatus?.(trayStatus);
  }, [trayStatus]);

  useEffect(() => {
    return () => {
      window.electronAPI?.updateTrayStatus?.({
        stage: "idle",
        stageLabel: "Ready",
        message: "",
      });
    };
  }, []);

  return null;
}
