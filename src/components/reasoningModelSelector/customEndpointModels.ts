import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_ENDPOINTS, buildApiUrl, normalizeBaseUrl } from "../../config/constants";
import { getProviderIcon, isMonochromeProvider } from "../../utils/providerIcons";
import { isSecureEndpoint } from "../../utils/urlUtils";

export type CloudModelOption = {
  value: string;
  label: string;
  description?: string;
  icon?: string;
  ownedBy?: string;
  invertInDark?: boolean;
};

const OWNED_BY_ICON_RULES: Array<{ match: RegExp; provider: string }> = [
  { match: /(openai|system|default|gpt|davinci)/, provider: "openai" },
  { match: /(azure)/, provider: "openai" },
  { match: /(anthropic|claude)/, provider: "anthropic" },
  { match: /(google|gemini)/, provider: "gemini" },
  { match: /(meta|llama)/, provider: "llama" },
  { match: /(mistral)/, provider: "mistral" },
  { match: /(qwen|ali|tongyi)/, provider: "qwen" },
  { match: /(openrouter|oss)/, provider: "openai-oss" },
];

const resolveOwnedByIcon = (ownedBy?: string): { icon?: string; invertInDark: boolean } => {
  if (!ownedBy) return { icon: undefined, invertInDark: false };
  const normalized = ownedBy.toLowerCase();
  const rule = OWNED_BY_ICON_RULES.find(({ match }) => match.test(normalized));
  if (rule) {
    return {
      icon: getProviderIcon(rule.provider),
      invertInDark: isMonochromeProvider(rule.provider),
    };
  }
  return { icon: undefined, invertInDark: false };
};

export const mapModelsPayloadToOptions = (payload: unknown): CloudModelOption[] => {
  const candidate = payload as { data?: unknown; models?: unknown } | null;
  const rawModels = Array.isArray(candidate?.data)
    ? candidate?.data
    : Array.isArray(candidate?.models)
      ? candidate?.models
      : [];

  return (rawModels as Array<Record<string, unknown>>)
    .map((item) => {
      const value = (item?.id || item?.name) as string | undefined;
      if (!value) return null;
      const ownedBy = typeof item?.owned_by === "string" ? item.owned_by : undefined;
      const { icon, invertInDark } = resolveOwnedByIcon(ownedBy);
      return {
        value,
        label: (item?.id || item?.name || value) as string,
        description: (item?.description as string) || (ownedBy ? `Owner: ${ownedBy}` : undefined),
        icon,
        ownedBy,
        invertInDark,
      } satisfies CloudModelOption;
    })
    .filter(Boolean) as CloudModelOption[];
};

export const fetchCustomEndpointModels = async ({
  baseUrl,
  apiKey,
  fetchFn = fetch,
}: {
  baseUrl: string;
  apiKey?: string;
  fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}): Promise<CloudModelOption[]> => {
  const normalizedBase = normalizeBaseUrl(baseUrl || "");
  if (!normalizedBase) return [];

  if (!normalizedBase.includes("://")) {
    throw new Error("Enter a full base URL including protocol (e.g. https://server/v1).");
  }

  if (!isSecureEndpoint(normalizedBase)) {
    throw new Error("HTTPS required (HTTP allowed for local network only).");
  }

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const modelsUrl = buildApiUrl(normalizedBase, "/models");
  const response = await fetchFn(modelsUrl, { method: "GET", headers });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const summary = errorText
      ? `${response.status} ${errorText.slice(0, 200)}`
      : `${response.status} ${response.statusText}`;
    throw new Error(summary.trim());
  }

  const payload = await response.json().catch(() => ({}));
  return mapModelsPayloadToOptions(payload);
};

export const useCustomEndpointModels = ({
  enabled,
  cloudReasoningBaseUrl,
  setCloudReasoningBaseUrl,
  customReasoningApiKey,
  reasoningModel,
  setReasoningModel,
}: {
  enabled: boolean;
  cloudReasoningBaseUrl: string;
  setCloudReasoningBaseUrl: (value: string) => void;
  customReasoningApiKey: string;
  reasoningModel: string;
  setReasoningModel: (model: string) => void;
}) => {
  const [customModelOptions, setCustomModelOptions] = useState<CloudModelOption[]>([]);
  const [customModelsLoading, setCustomModelsLoading] = useState(false);
  const [customModelsError, setCustomModelsError] = useState<string | null>(null);
  const [customBaseInput, setCustomBaseInput] = useState(cloudReasoningBaseUrl);
  const lastLoadedBaseRef = useRef<string | null>(null);
  const pendingBaseRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setCustomBaseInput(cloudReasoningBaseUrl);
  }, [cloudReasoningBaseUrl]);

  const defaultOpenAIBase = useMemo(() => normalizeBaseUrl(API_ENDPOINTS.OPENAI_BASE), []);
  const normalizedCustomReasoningBase = useMemo(
    () => normalizeBaseUrl(cloudReasoningBaseUrl),
    [cloudReasoningBaseUrl]
  );
  const latestReasoningBaseRef = useRef(normalizedCustomReasoningBase);

  useEffect(() => {
    latestReasoningBaseRef.current = normalizedCustomReasoningBase;
  }, [normalizedCustomReasoningBase]);

  const hasCustomBase = normalizedCustomReasoningBase !== "";
  const effectiveReasoningBase = hasCustomBase ? normalizedCustomReasoningBase : defaultOpenAIBase;

  const loadRemoteModels = useCallback(
    async (baseOverride?: string, force = false) => {
      const rawBase = (baseOverride ?? cloudReasoningBaseUrl) || "";
      const normalizedBase = normalizeBaseUrl(rawBase);

      if (!normalizedBase) {
        if (isMountedRef.current) {
          setCustomModelsLoading(false);
          setCustomModelsError(null);
          setCustomModelOptions([]);
        }
        return;
      }

      if (!force && lastLoadedBaseRef.current === normalizedBase) return;
      if (!force && pendingBaseRef.current === normalizedBase) return;

      if (baseOverride !== undefined) {
        latestReasoningBaseRef.current = normalizedBase;
      }

      pendingBaseRef.current = normalizedBase;

      if (isMountedRef.current) {
        setCustomModelsLoading(true);
        setCustomModelsError(null);
        setCustomModelOptions([]);
      }

      const apiKey = customReasoningApiKey?.trim() || undefined;

      try {
        const mappedModels = await fetchCustomEndpointModels({
          baseUrl: normalizedBase,
          apiKey,
        });

        if (isMountedRef.current && latestReasoningBaseRef.current === normalizedBase) {
          setCustomModelOptions(mappedModels);
          if (
            reasoningModel &&
            mappedModels.length > 0 &&
            !mappedModels.some((model) => model.value === reasoningModel)
          ) {
            setReasoningModel("");
          }
          setCustomModelsError(null);
          lastLoadedBaseRef.current = normalizedBase;
        }
      } catch (error) {
        if (isMountedRef.current && latestReasoningBaseRef.current === normalizedBase) {
          const message = (error as Error).message || "Unable to load models from endpoint.";
          const unauthorized = /\b(401|403)\b/.test(message);
          if (unauthorized && !apiKey) {
            setCustomModelsError(
              "Endpoint rejected the request (401/403). Add an API key or adjust server auth settings."
            );
          } else {
            setCustomModelsError(message);
          }
          setCustomModelOptions([]);
        }
      } finally {
        if (pendingBaseRef.current === normalizedBase) {
          pendingBaseRef.current = null;
        }
        if (isMountedRef.current && latestReasoningBaseRef.current === normalizedBase) {
          setCustomModelsLoading(false);
        }
      }
    },
    [cloudReasoningBaseUrl, customReasoningApiKey, reasoningModel, setReasoningModel]
  );

  const trimmedCustomBase = customBaseInput.trim();
  const hasSavedCustomBase = Boolean((cloudReasoningBaseUrl || "").trim());
  const isCustomBaseDirty = trimmedCustomBase !== (cloudReasoningBaseUrl || "").trim();

  const displayedCustomModels = useMemo<CloudModelOption[]>(() => {
    if (isCustomBaseDirty) return [];
    return customModelOptions;
  }, [isCustomBaseDirty, customModelOptions]);

  const handleApplyCustomBase = useCallback(() => {
    const trimmedBase = customBaseInput.trim();
    const normalized = trimmedBase ? normalizeBaseUrl(trimmedBase) : trimmedBase;
    setCustomBaseInput(normalized);
    setCloudReasoningBaseUrl(normalized);
    lastLoadedBaseRef.current = null;
    loadRemoteModels(normalized, true);
  }, [customBaseInput, setCloudReasoningBaseUrl, loadRemoteModels]);

  const handleBaseUrlBlur = useCallback(() => {
    const trimmedBase = customBaseInput.trim();
    if (!trimmedBase) return;

    // Auto-apply on blur if changed
    if (trimmedBase !== (cloudReasoningBaseUrl || "").trim()) {
      handleApplyCustomBase();
    }
  }, [customBaseInput, cloudReasoningBaseUrl, handleApplyCustomBase]);

  const handleResetCustomBase = useCallback(() => {
    const defaultBase = API_ENDPOINTS.OPENAI_BASE;
    setCustomBaseInput(defaultBase);
    setCloudReasoningBaseUrl(defaultBase);
    lastLoadedBaseRef.current = null;
    loadRemoteModels(defaultBase, true);
  }, [setCloudReasoningBaseUrl, loadRemoteModels]);

  const handleRefreshCustomModels = useCallback(() => {
    if (isCustomBaseDirty) {
      handleApplyCustomBase();
      return;
    }
    if (!trimmedCustomBase) return;
    loadRemoteModels(undefined, true);
  }, [handleApplyCustomBase, isCustomBaseDirty, trimmedCustomBase, loadRemoteModels]);

  useEffect(() => {
    if (!enabled) return;
    if (!hasCustomBase) {
      setCustomModelsError(null);
      setCustomModelOptions([]);
      setCustomModelsLoading(false);
      lastLoadedBaseRef.current = null;
      pendingBaseRef.current = null;
      return;
    }

    const normalizedBase = normalizedCustomReasoningBase;
    if (!normalizedBase) return;
    if (pendingBaseRef.current === normalizedBase || lastLoadedBaseRef.current === normalizedBase)
      return;

    loadRemoteModels();
  }, [enabled, hasCustomBase, normalizedCustomReasoningBase, loadRemoteModels]);

  return {
    customBaseInput,
    setCustomBaseInput,
    customModelOptions,
    displayedCustomModels,
    customModelsLoading,
    customModelsError,
    defaultOpenAIBase,
    effectiveReasoningBase,
    hasCustomBase,
    hasSavedCustomBase,
    isCustomBaseDirty,
    trimmedCustomBase,
    handleApplyCustomBase,
    handleBaseUrlBlur,
    handleResetCustomBase,
    handleRefreshCustomModels,
    loadRemoteModels,
  };
};

export type CustomEndpointModelsState = ReturnType<typeof useCustomEndpointModels>;
