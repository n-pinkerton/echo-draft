import { useCallback, useEffect, useRef } from "react";

import { API_ENDPOINTS } from "../../config/constants";
import { normalizeCleanupModelId } from "../../config/prompts";
import { ECHO_DRAFT_CLOUD_MODE, normalizeCloudMode } from "../../utils/branding";
import type { CleanupReasoningEffort } from "../../services/BaseReasoningService";
import type { CustomEndpointApprovalOutcome } from "../../types/customEndpoint";
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

  const [reasoningProvider, setReasoningProviderStored] = useLocalStorage(
    "reasoningProvider",
    "openai",
    {
      serialize: String,
      deserialize: String,
    }
  );
  const reasoningProviderRef = useRef(reasoningProvider);
  const setReasoningProvider = useCallback(
    (value: string) => {
      reasoningProviderRef.current = value;
      setReasoningProviderStored(value);
    },
    [setReasoningProviderStored]
  );

  useEffect(() => {
    reasoningProviderRef.current = reasoningProvider;
  }, [reasoningProvider]);

  const [cleanupReasoningEffort, setCleanupReasoningEffort] =
    useLocalStorage<CleanupReasoningEffort>("cleanupReasoningEffort", "none", {
      serialize: String,
      deserialize: (value) =>
        value === "none" || value === "low" || value === "medium" ? value : "none",
    });

  const [cloudReasoningBaseUrl, setCloudReasoningBaseUrlStored] = useLocalStorage(
    "cloudReasoningBaseUrl",
    API_ENDPOINTS.OPENAI_BASE,
    {
      serialize: String,
      deserialize: String,
    }
  );
  const endpointApprovalSequence = useRef(0);

  const setCloudReasoningBaseUrl = useCallback(
    async (value: string): Promise<CustomEndpointApprovalOutcome> => {
      const sequence = ++endpointApprovalSequence.current;
      if (reasoningProviderRef.current !== "custom") {
        setCloudReasoningBaseUrlStored(value);
        return { status: "approved", endpoint: value };
      }

      const approve = window.electronAPI?.approveCustomProviderEndpoint;
      if (!approve) {
        console.warn("Secure custom reasoning endpoint approval is unavailable");
        return {
          status: "error",
          message:
            "Secure custom endpoint approval is unavailable. Restart or reinstall EchoDraft.",
        };
      }
      try {
        const result = await approve("reasoning", value);
        if (sequence !== endpointApprovalSequence.current) {
          return {
            status: "superseded",
            message: "A newer endpoint change replaced this request.",
          };
        }
        if (result?.cancelled) {
          return {
            status: "cancelled",
            message: "Endpoint approval was cancelled. Your previous endpoint is unchanged.",
          };
        }
        if (!result?.success || !result.endpoint) {
          return {
            status: "error",
            message: "EchoDraft could not approve this endpoint. Check the URL and try again.",
          };
        }
        setCloudReasoningBaseUrlStored(result.endpoint);
        return { status: "approved", endpoint: result.endpoint };
      } catch (error) {
        if (sequence === endpointApprovalSequence.current) {
          console.warn("Custom reasoning endpoint was not approved", error);
        }
        const detail = error instanceof Error ? error.message : String(error);
        const invalid = /invalid custom endpoint|must use https|invalid url|failed to parse/i.test(
          detail
        );
        return {
          status: invalid ? "invalid" : "error",
          message: invalid
            ? "Enter a valid HTTPS endpoint (HTTP is allowed only for localhost)."
            : "EchoDraft could not approve this endpoint. Check the URL and try again.",
        };
      }
    },
    [setCloudReasoningBaseUrlStored]
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
