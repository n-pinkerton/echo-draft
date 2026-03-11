import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalModel } from "./modelTypes";
import { addModelsClearedListener } from "../../../utils/branding";

interface UseWhisperModelsOptions {
  enabled: boolean;
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
}

export function useWhisperModels({ enabled, selectedModel, onSelectModel }: UseWhisperModelsOptions) {
  const [models, setModels] = useState<LocalModel[]>([]);
  const isLoadingRef = useRef(false);

  const validateAndSelectModel = useCallback(
    (loadedModels: LocalModel[]) => {
      if (!selectedModel) return;

      const downloaded = loadedModels.filter((m) => m.downloaded);
      const isCurrentDownloaded = loadedModels.find((m) => m.model === selectedModel)?.downloaded;

      if (!isCurrentDownloaded && downloaded.length > 0) {
        onSelectModel(downloaded[0].model);
      } else if (!isCurrentDownloaded && downloaded.length === 0) {
        onSelectModel("");
      }
    },
    [onSelectModel, selectedModel]
  );

  const reload = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    try {
      const result = await window.electronAPI?.listWhisperModels();
      if (result?.success) {
        setModels(result.models);
        validateAndSelectModel(result.models);
      }
    } catch (error) {
      console.error("[useWhisperModels] Failed to load models:", error);
      setModels([]);
    } finally {
      isLoadingRef.current = false;
    }
  }, [validateAndSelectModel]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, reload]);

  useEffect(() => {
    const handleModelsCleared = () => void reload();
    return addModelsClearedListener(handleModelsCleared);
  }, [reload]);

  return { models, reload };
}
