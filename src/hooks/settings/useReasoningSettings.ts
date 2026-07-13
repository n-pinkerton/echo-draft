import { useCallback, useEffect } from "react";

import { API_ENDPOINTS } from "../../config/constants";
import { normalizeCleanupModelId } from "../../config/prompts";
import { ECHO_DRAFT_CLOUD_MODE, normalizeCloudMode } from "../../utils/branding";
import type { CleanupReasoningEffort } from "../../services/BaseReasoningService";
import { useLocalStorage } from "../useLocalStorage";
import type { ReasoningSettings } from "./settingsTypes";

export function useReasoningSettings() {
  const [useReasoningModel, setUseReasoningModel] = useLocalStorage("useReasoningModel", true, {
    serialize: String,
    deserialize: (value) => value !== "false",
  });

  const [reasoningModel, setReasoningModel] = useLocalStorage("reasoningModel", "", {
    serialize: String,
    deserialize: String,
  });

  const [reasoningProvider, setReasoningProvider] = useLocalStorage("reasoningProvider", "openai", {
    serialize: String,
    deserialize: String,
  });

  const [cleanupReasoningEffort, setCleanupReasoningEffort] =
    useLocalStorage<CleanupReasoningEffort>("cleanupReasoningEffort", "low", {
      serialize: String,
      deserialize: (value) =>
        value === "none" || value === "low" || value === "medium" ? value : "low",
    });

  const [cloudReasoningBaseUrl, setCloudReasoningBaseUrl] = useLocalStorage(
    "cloudReasoningBaseUrl",
    API_ENDPOINTS.OPENAI_BASE,
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [cloudReasoningMode, setCloudReasoningMode] = useLocalStorage(
    "cloudReasoningMode",
    ECHO_DRAFT_CLOUD_MODE,
    {
      serialize: String,
      deserialize: (value) => normalizeCloudMode(String(value)),
    }
  );

  useEffect(() => {
    const migratedModel = normalizeCleanupModelId(reasoningModel, reasoningProvider);
    if (migratedModel && migratedModel !== reasoningModel) {
      setReasoningModel(migratedModel);
    }
  }, [reasoningModel, reasoningProvider, setReasoningModel]);

  const updateReasoningSettings = useCallback(
    (settings: Partial<ReasoningSettings>) => {
      if (settings.useReasoningModel !== undefined)
        setUseReasoningModel(settings.useReasoningModel);
      if (settings.reasoningModel !== undefined) setReasoningModel(settings.reasoningModel);
      if (settings.reasoningProvider !== undefined)
        setReasoningProvider(settings.reasoningProvider);
      if (settings.cleanupReasoningEffort !== undefined)
        setCleanupReasoningEffort(settings.cleanupReasoningEffort);
      if (settings.cloudReasoningBaseUrl !== undefined)
        setCloudReasoningBaseUrl(settings.cloudReasoningBaseUrl);
      if (settings.cloudReasoningMode !== undefined)
        setCloudReasoningMode(settings.cloudReasoningMode);
    },
    [
      setCloudReasoningBaseUrl,
      setCloudReasoningMode,
      setReasoningModel,
      setReasoningProvider,
      setCleanupReasoningEffort,
      setUseReasoningModel,
    ]
  );

  return {
    useReasoningModel,
    reasoningModel,
    reasoningProvider,
    cleanupReasoningEffort,
    cloudReasoningBaseUrl,
    cloudReasoningMode,
    setUseReasoningModel,
    setReasoningModel,
    setReasoningProvider,
    setCleanupReasoningEffort,
    setCloudReasoningBaseUrl,
    setCloudReasoningMode,
    updateReasoningSettings,
  };
}
