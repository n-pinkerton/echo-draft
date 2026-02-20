import { useCallback } from "react";

import { API_ENDPOINTS } from "../../config/constants";
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
    "openwhispr",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const updateReasoningSettings = useCallback(
    (settings: Partial<ReasoningSettings>) => {
      if (settings.useReasoningModel !== undefined)
        setUseReasoningModel(settings.useReasoningModel);
      if (settings.reasoningModel !== undefined) setReasoningModel(settings.reasoningModel);
      if (settings.reasoningProvider !== undefined)
        setReasoningProvider(settings.reasoningProvider);
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
      setUseReasoningModel,
    ]
  );

  return {
    useReasoningModel,
    reasoningModel,
    reasoningProvider,
    cloudReasoningBaseUrl,
    cloudReasoningMode,
    setUseReasoningModel,
    setReasoningModel,
    setReasoningProvider,
    setCloudReasoningBaseUrl,
    setCloudReasoningMode,
    updateReasoningSettings,
  };
}

