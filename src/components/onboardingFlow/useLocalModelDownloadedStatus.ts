import { useEffect, useState } from "react";

type LocalModelDownloadedStatusParams = {
  useLocalWhisper: boolean;
  whisperModel: string;
  parakeetModel: string;
  localTranscriptionProvider: "whisper" | "nvidia" | string;
};

export const useLocalModelDownloadedStatus = ({
  useLocalWhisper,
  whisperModel,
  parakeetModel,
  localTranscriptionProvider,
}: LocalModelDownloadedStatusParams): boolean => {
  const [isModelDownloaded, setIsModelDownloaded] = useState(false);

  useEffect(() => {
    const modelToCheck = localTranscriptionProvider === "nvidia" ? parakeetModel : whisperModel;

    if (!useLocalWhisper || !modelToCheck) {
      setIsModelDownloaded(false);
      return;
    }

    let isActive = true;

    const checkStatus = async () => {
      try {
        if (!window.electronAPI) {
          if (isActive) {
            setIsModelDownloaded(false);
          }
          return;
        }

        const result =
          localTranscriptionProvider === "nvidia"
            ? await window.electronAPI?.checkParakeetModelStatus?.(modelToCheck)
            : await window.electronAPI?.checkModelStatus?.(modelToCheck);

        if (isActive) {
          setIsModelDownloaded(result?.downloaded ?? false);
        }
      } catch (error) {
        console.error("Failed to check model status:", error);
        if (isActive) {
          setIsModelDownloaded(false);
        }
      }
    };

    void checkStatus();

    return () => {
      isActive = false;
    };
  }, [useLocalWhisper, whisperModel, parakeetModel, localTranscriptionProvider]);

  return isModelDownloaded;
};

