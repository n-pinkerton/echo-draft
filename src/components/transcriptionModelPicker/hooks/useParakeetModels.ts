import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalModel } from "./modelTypes";
import { addModelsClearedListener } from "../../../utils/branding";

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
    return addModelsClearedListener(handleModelsCleared);
  }, [reload]);

  return { models, reload };
}
