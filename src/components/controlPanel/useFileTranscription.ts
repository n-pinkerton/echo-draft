import { useCallback, useRef, useState } from "react";

import AudioManager from "../../helpers/audioManager";
import logger from "../../utils/logger";

type ToastFn = (args: {
  title: string;
  description?: string;
  variant?: "success" | "destructive" | "default";
  duration?: number;
}) => void;

const createSessionId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export function useFileTranscription(toast: ToastFn, useReasoningModel: boolean) {
  const [showFileTranscribeDialog, setShowFileTranscribeDialog] = useState(false);
  const [fileCleanupEnabled, setFileCleanupEnabled] = useState(
    () => localStorage.getItem("useReasoningModel") === "true"
  );
  const [fileTranscribeStageLabel, setFileTranscribeStageLabel] = useState<string | null>(null);
  const [fileTranscribeMessage, setFileTranscribeMessage] = useState<string | null>(null);
  const [fileTranscribeFileName, setFileTranscribeFileName] = useState<string | null>(null);
  const [isFileTranscribing, setIsFileTranscribing] = useState(false);

  const resetProgressState = useCallback(() => {
    setFileTranscribeStageLabel(null);
    setFileTranscribeMessage(null);
    setFileTranscribeFileName(null);
  }, []);

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      setShowFileTranscribeDialog(open);
      if (open) {
        setFileCleanupEnabled(useReasoningModel);
        resetProgressState();
      }
    },
    [resetProgressState, useReasoningModel]
  );

  const transcribeAudioFile = useCallback(async () => {
    if (isFileTranscribing) return;
    if (!window.electronAPI?.selectAudioFileForTranscription) {
      toast({
        title: "Unavailable",
        description: "This build does not support file transcription yet.",
        variant: "destructive",
      });
      return;
    }

    resetProgressState();

    const selection = await window.electronAPI.selectAudioFileForTranscription();
    if (selection?.canceled) {
      return;
    }
    if (!selection?.success) {
      toast({
        title: "File Selection Failed",
        description: selection?.error || "Could not read the selected file.",
        variant: "destructive",
      });
      return;
    }
    if (!selection.data || selection.data.byteLength === 0) {
      toast({
        title: "File Selection Failed",
        description: "Selected file was empty or could not be read.",
        variant: "destructive",
      });
      return;
    }

    const fileName = selection.fileName || "audio";
    const mimeType = selection.mimeType || "application/octet-stream";
    const bytes = new Uint8Array(selection.data.byteLength);
    bytes.set(selection.data);
    const audioBlob = new Blob([bytes.buffer], { type: mimeType });

    const sessionId = createSessionId();
    const startedAt = Date.now();
    const context = {
      sessionId,
      outputMode: "file",
      triggeredAt: startedAt,
      cleanupEnabled: fileCleanupEnabled,
      file: {
        fileName,
        extension: selection.extension ?? null,
        mimeType,
        sizeBytes: selection.sizeBytes ?? null,
      },
    };

    logger.info(
      "File transcription started",
      {
        sessionId,
        fileName,
        mimeType,
        sizeBytes: selection.sizeBytes ?? null,
        cleanupEnabled: fileCleanupEnabled,
      },
      "file"
    );

    setFileTranscribeFileName(fileName);
    setIsFileTranscribing(true);

    const manager = new AudioManager();
    const providerRef = { current: null as null | string };
    const modelRef = { current: null as null | string };
    const lastStageRef = { current: null as null | string };

    const finalize = () => {
      try {
        manager.cleanup();
      } catch {
        // Ignore cleanup errors
      }
    };

    manager.setCallbacks({
      onStateChange: (state) => {
        logger.trace("File transcription state change", { sessionId, ...state }, "file");
      },
      onProgress: (event) => {
        if (event?.provider) {
          providerRef.current = String(event.provider);
        }
        if (event?.model) {
          modelRef.current = String(event.model);
        }
        if (typeof event?.stage === "string" && event.stage && event.stage !== lastStageRef.current) {
          lastStageRef.current = event.stage;
          setFileTranscribeStageLabel(event.stageLabel || event.stage);
          setFileTranscribeMessage(typeof event.message === "string" ? event.message : null);
          logger.trace(
            "File transcription stage",
            {
              sessionId,
              stage: event.stage,
              stageLabel: event.stageLabel || null,
              message: event.message || null,
              provider: event.provider || null,
              model: event.model || null,
            },
            "file"
          );
        }
      },
      onPartialTranscript: () => {},
      onError: (error) => {
        logger.error("File transcription error", { sessionId, error }, "file");
        toast({
          title: error?.title || "Transcription Error",
          description: error?.description || "Failed to transcribe audio file.",
          variant: "destructive",
          duration: 7000,
        });
        setIsFileTranscribing(false);
        finalize();
      },
      onTranscriptionComplete: async (result) => {
        try {
          if (!result?.success) {
            throw new Error("Transcription failed");
          }

          const provider = providerRef.current || result.source || null;
          const model = modelRef.current || null;
          const totalDurationMs = Math.max(0, Date.now() - startedAt);

          const saveResult = await window.electronAPI.saveTranscription({
            text: result.text,
            rawText: result.rawText ?? result.text,
            meta: {
              sessionId,
              outputMode: "file",
              status: "success",
              source: result.source,
              provider,
              model,
              cleanupEnabled: fileCleanupEnabled,
              file: context.file,
              timings: {
                ...(result.timings || {}),
                totalDurationMs,
              },
            },
          });

          if (!saveResult?.success) {
            throw new Error("Saved transcription to history failed");
          }

          toast({
            title: "Transcribed",
            description: "Saved to history.",
            variant: "success",
            duration: 2500,
          });

          logger.info(
            "File transcription saved",
            {
              sessionId,
              transcriptionId: saveResult.id ?? null,
              provider,
              model,
              textLength: result.text?.length ?? null,
              rawTextLength: result.rawText?.length ?? null,
              totalDurationMs,
            },
            "file"
          );
        } catch (error) {
          toast({
            title: "Transcription Failed",
            description: (error as Error)?.message || "An unexpected error occurred.",
            variant: "destructive",
            duration: 7000,
          });
          logger.error(
            "File transcription completion handler failed",
            { sessionId, error: (error as Error)?.message || String(error) },
            "file"
          );
        } finally {
          setIsFileTranscribing(false);
          setShowFileTranscribeDialog(false);
          resetProgressState();
          finalize();
        }
      },
    });

    manager.enqueueProcessingJob(audioBlob, {}, context);
  }, [fileCleanupEnabled, isFileTranscribing, resetProgressState, toast]);

  return {
    showFileTranscribeDialog,
    handleDialogOpenChange,
    fileCleanupEnabled,
    setFileCleanupEnabled,
    fileTranscribeStageLabel,
    fileTranscribeMessage,
    fileTranscribeFileName,
    isFileTranscribing,
    transcribeAudioFile,
  };
}

