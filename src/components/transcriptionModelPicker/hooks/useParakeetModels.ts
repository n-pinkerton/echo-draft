import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalModel } from "./modelTypes";

interface UseParakeetModelsOptions {
  enabled: boolean;
}

export function useParakeetModels({ enabled }: UseParakeetModelsOptions) {
  const [models, setModels] = useState<LocalModel[]>([]);
  const isLoadingRef = useRef(false);

  const reload = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    try {
      const result = await window.electronAPI?.listParakeetModels();
      if (result?.success) {
        setModels(result.models);
      }
    } catch (error) {
      console.error("[useParakeetModels] Failed to load models:", error);
      setModels([]);
    } finally {
      isLoadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, reload]);

  useEffect(() => {
    const handleModelsCleared = () => void reload();
    window.addEventListener("openwhispr-models-cleared", handleModelsCleared);
    return () => window.removeEventListener("openwhispr-models-cleared", handleModelsCleared);
  }, [reload]);

  return { models, reload };
}
