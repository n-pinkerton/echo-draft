import { useEffect } from "react";

import logger from "../../utils/logger";
import type { LocalTranscriptionProvider } from "../../types/electron";

export function useStartupPreferencesSync({
  useLocalWhisper,
  localTranscriptionProvider,
  whisperModel,
  parakeetModel,
  reasoningProvider,
  reasoningModel,
}: {
  useLocalWhisper: boolean;
  localTranscriptionProvider: LocalTranscriptionProvider;
  whisperModel: string;
  parakeetModel: string;
  reasoningProvider: string;
  reasoningModel: string;
}) {
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.syncStartupPreferences) return;

    const model = localTranscriptionProvider === "nvidia" ? parakeetModel : whisperModel;
    window.electronAPI
      .syncStartupPreferences({
        useLocalWhisper,
        localTranscriptionProvider,
        model: model || undefined,
        reasoningProvider,
        reasoningModel: reasoningProvider === "local" ? reasoningModel : undefined,
      })
      .catch((err) =>
        logger.warn(
          "Failed to sync startup preferences",
          { error: (err as Error).message },
          "settings"
        )
      );
  }, [
    useLocalWhisper,
    localTranscriptionProvider,
    whisperModel,
    parakeetModel,
    reasoningProvider,
    reasoningModel,
  ]);
}

