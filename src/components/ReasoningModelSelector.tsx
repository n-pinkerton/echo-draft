import { useState, useEffect, useCallback, useMemo } from "react";
import { Cloud, Lock } from "lucide-react";
import ModelCardList from "./ui/ModelCardList";
import LocalModelPicker, { type LocalProvider } from "./LocalModelPicker";
import { ProviderTabs } from "./ui/ProviderTabs";
import { REASONING_PROVIDERS } from "../models/ModelRegistry";
import { modelRegistry } from "../models/ModelRegistry";
import { getProviderIcon, isMonochromeProvider } from "../utils/providerIcons";
import { CloudApiKeySection } from "./reasoningModelSelector/CloudApiKeySection";
import { CustomEndpointPanel } from "./reasoningModelSelector/CustomEndpointPanel";
import {
  type CloudModelOption,
  useCustomEndpointModels,
} from "./reasoningModelSelector/customEndpointModels";

const CLOUD_PROVIDER_IDS = ["openai", "anthropic", "gemini", "groq", "custom"] as const;

interface ReasoningModelSelectorProps {
  useReasoningModel: boolean;
  setUseReasoningModel: (value: boolean) => void;
  reasoningModel: string;
  setReasoningModel: (model: string) => void;
  localReasoningProvider: string;
  setLocalReasoningProvider: (provider: string) => void;
  cloudReasoningBaseUrl: string;
  setCloudReasoningBaseUrl: (value: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  anthropicApiKey: string;
  setAnthropicApiKey: (key: string) => void;
  geminiApiKey: string;
  setGeminiApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  customReasoningApiKey?: string;
  setCustomReasoningApiKey?: (key: string) => void;
  showAlertDialog: (dialog: { title: string; description: string }) => void;
}

export default function ReasoningModelSelector({
  useReasoningModel,
  setUseReasoningModel,
  reasoningModel,
  setReasoningModel,
  localReasoningProvider,
  setLocalReasoningProvider,
  cloudReasoningBaseUrl,
  setCloudReasoningBaseUrl,
  openaiApiKey,
  setOpenaiApiKey,
  anthropicApiKey,
  setAnthropicApiKey,
  geminiApiKey,
  setGeminiApiKey,
  groqApiKey,
  setGroqApiKey,
  customReasoningApiKey = "",
  setCustomReasoningApiKey,
}: ReasoningModelSelectorProps) {
  const [selectedMode, setSelectedMode] = useState<"cloud" | "local">("cloud");
  const [selectedCloudProvider, setSelectedCloudProvider] = useState("openai");
  const [selectedLocalProvider, setSelectedLocalProvider] = useState("qwen");
  const customEndpoint = useCustomEndpointModels({
    enabled: selectedCloudProvider === "custom",
    cloudReasoningBaseUrl,
    setCloudReasoningBaseUrl,
    customReasoningApiKey,
    reasoningModel,
    setReasoningModel,
  });

  const cloudProviders = CLOUD_PROVIDER_IDS.map((id) => ({
    id,
    name:
      id === "custom"
        ? "Custom"
        : REASONING_PROVIDERS[id as keyof typeof REASONING_PROVIDERS]?.name || id,
  }));

  const localProviders = useMemo<LocalProvider[]>(() => {
    return modelRegistry.getAllProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      models: provider.models.map((model) => ({
        id: model.id,
        name: model.name,
        size: model.size,
        sizeBytes: model.sizeBytes,
        description: model.description,
        recommended: model.recommended,
      })),
    }));
  }, []);

  const openaiModelOptions = useMemo<CloudModelOption[]>(() => {
    const iconUrl = getProviderIcon("openai");
    return REASONING_PROVIDERS.openai.models.map((model) => ({
      ...model,
      icon: iconUrl,
      invertInDark: true,
    }));
  }, []);

  const selectedCloudModels = useMemo<CloudModelOption[]>(() => {
    if (selectedCloudProvider === "openai") return openaiModelOptions;
    if (selectedCloudProvider === "custom") return customEndpoint.displayedCustomModels;

    const provider = REASONING_PROVIDERS[selectedCloudProvider as keyof typeof REASONING_PROVIDERS];
    if (!provider?.models) return [];

    const iconUrl = getProviderIcon(selectedCloudProvider);
    const invertInDark = isMonochromeProvider(selectedCloudProvider);
    return provider.models.map((model) => ({
      ...model,
      icon: iconUrl,
      invertInDark,
    }));
  }, [selectedCloudProvider, openaiModelOptions, customEndpoint.displayedCustomModels]);

  useEffect(() => {
    const localProviderIds = localProviders.map((p) => p.id);
    if (localProviderIds.includes(localReasoningProvider)) {
      setSelectedMode("local");
      setSelectedLocalProvider(localReasoningProvider);
    } else if (
      CLOUD_PROVIDER_IDS.includes(localReasoningProvider as (typeof CLOUD_PROVIDER_IDS)[number])
    ) {
      setSelectedMode("cloud");
      setSelectedCloudProvider(localReasoningProvider);
    }
  }, [localProviders, localReasoningProvider]);

  const [downloadedModels, setDownloadedModels] = useState<Set<string>>(new Set());

  const loadDownloadedModels = useCallback(async () => {
    try {
      const result = await window.electronAPI?.modelGetAll?.();
      if (result && Array.isArray(result)) {
        const downloaded = new Set(
          result
            .filter((m: { isDownloaded?: boolean }) => m.isDownloaded)
            .map((m: { id: string }) => m.id)
        );
        setDownloadedModels(downloaded);
        return downloaded;
      }
    } catch (error) {
      console.error("Failed to load downloaded models:", error);
    }
    return new Set<string>();
  }, []);

  useEffect(() => {
    loadDownloadedModels();
  }, [loadDownloadedModels]);

  const handleModeChange = async (newMode: "cloud" | "local") => {
    setSelectedMode(newMode);

    if (newMode === "cloud") {
      setLocalReasoningProvider(selectedCloudProvider);

      if (selectedCloudProvider === "custom") {
        customEndpoint.setCustomBaseInput(cloudReasoningBaseUrl);

        if (customEndpoint.customModelOptions.length > 0) {
          setReasoningModel(customEndpoint.customModelOptions[0].value);
        } else if (customEndpoint.hasCustomBase) {
          customEndpoint.loadRemoteModels();
        }
        return;
      }

      const provider =
        REASONING_PROVIDERS[selectedCloudProvider as keyof typeof REASONING_PROVIDERS];
      if (provider?.models?.length > 0) {
        setReasoningModel(provider.models[0].value);
      }
    } else {
      setLocalReasoningProvider(selectedLocalProvider);
      const downloaded = await loadDownloadedModels();
      const provider = localProviders.find((p) => p.id === selectedLocalProvider);
      const models = provider?.models ?? [];
      if (models.length > 0) {
        const firstDownloaded = models.find((m) => downloaded.has(m.id));
        if (firstDownloaded) {
          setReasoningModel(firstDownloaded.id);
        } else {
          setReasoningModel("");
        }
      }
    }
  };

  const handleCloudProviderChange = (provider: string) => {
    setSelectedCloudProvider(provider);
    setLocalReasoningProvider(provider);

    if (provider === "custom") {
      customEndpoint.setCustomBaseInput(cloudReasoningBaseUrl);

      if (customEndpoint.customModelOptions.length > 0) {
        setReasoningModel(customEndpoint.customModelOptions[0].value);
      } else if (customEndpoint.hasCustomBase) {
        customEndpoint.loadRemoteModels();
      }
      return;
    }

    const providerData = REASONING_PROVIDERS[provider as keyof typeof REASONING_PROVIDERS];
    if (providerData?.models?.length > 0) {
      setReasoningModel(providerData.models[0].value);
    }
  };

  const handleLocalProviderChange = async (providerId: string) => {
    setSelectedLocalProvider(providerId);
    setLocalReasoningProvider(providerId);
    const downloaded = await loadDownloadedModels();
    const provider = localProviders.find((p) => p.id === providerId);
    const models = provider?.models ?? [];
    if (models.length > 0) {
      const firstDownloaded = models.find((m) => downloaded.has(m.id));
      if (firstDownloaded) {
        setReasoningModel(firstDownloaded.id);
      } else {
        setReasoningModel("");
      }
    }
  };

  const MODE_TABS = [
    { id: "cloud", name: "Cloud" },
    { id: "local", name: "Local" },
  ];

  const renderModeIcon = (id: string) => {
    if (id === "cloud") return <Cloud className="w-4 h-4" />;
    return <Lock className="w-4 h-4" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between p-3 bg-card border border-border rounded-lg">
        <div>
          <label className="text-sm font-medium text-foreground">Enable AI Text Enhancement</label>
          <p className="text-xs text-muted-foreground">
            Use AI to automatically improve transcription quality
          </p>
        </div>
        <button
          onClick={() => setUseReasoningModel(!useReasoningModel)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
            useReasoningModel ? "bg-primary" : "bg-muted-foreground/25"
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200 ${
              useReasoningModel ? "translate-x-4.5" : "translate-x-0.75"
            }`}
          />
        </button>
      </div>

      {useReasoningModel && (
        <>
          <div className="space-y-2">
            <ProviderTabs
              providers={MODE_TABS}
              selectedId={selectedMode}
              onSelect={(id) => handleModeChange(id as "cloud" | "local")}
              renderIcon={renderModeIcon}
              colorScheme="purple"
            />
            <p className="text-xs text-muted-foreground text-center">
              {selectedMode === "local"
                ? "Runs on your device. Complete privacy, works offline."
                : "Advanced models via API. Fast and capable, requires internet."}
            </p>
          </div>

          {selectedMode === "cloud" ? (
            <div className="space-y-2">
              <div className="border border-border rounded-lg overflow-hidden">
                <ProviderTabs
                  providers={cloudProviders}
                  selectedId={selectedCloudProvider}
                  onSelect={handleCloudProviderChange}
                  colorScheme="indigo"
                />

                <div className="p-3">
                  {selectedCloudProvider === "custom" ? (
                    <CustomEndpointPanel
                      endpoint={customEndpoint}
                      customReasoningApiKey={customReasoningApiKey}
                      setCustomReasoningApiKey={setCustomReasoningApiKey || (() => {})}
                      reasoningModel={reasoningModel}
                      onModelSelect={setReasoningModel}
                    />
                  ) : (
                    <>
                      {selectedCloudProvider === "openai" && (
                        <CloudApiKeySection
                          url="https://platform.openai.com/api-keys"
                          apiKey={openaiApiKey}
                          setApiKey={setOpenaiApiKey}
                        />
                      )}

                      {selectedCloudProvider === "anthropic" && (
                        <CloudApiKeySection
                          url="https://console.anthropic.com/settings/keys"
                          apiKey={anthropicApiKey}
                          setApiKey={setAnthropicApiKey}
                          placeholder="sk-ant-..."
                        />
                      )}

                      {selectedCloudProvider === "gemini" && (
                        <CloudApiKeySection
                          url="https://aistudio.google.com/app/api-keys"
                          apiKey={geminiApiKey}
                          setApiKey={setGeminiApiKey}
                          placeholder="AIza..."
                        />
                      )}

                      {selectedCloudProvider === "groq" && (
                        <CloudApiKeySection
                          url="https://console.groq.com/keys"
                          apiKey={groqApiKey}
                          setApiKey={setGroqApiKey}
                          placeholder="gsk_..."
                        />
                      )}

                      <div className="pt-3 space-y-2">
                        <h4 className="text-sm font-medium text-foreground">Select Model</h4>
                        <ModelCardList
                          models={selectedCloudModels}
                          selectedModel={reasoningModel}
                          onModelSelect={setReasoningModel}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <LocalModelPicker
              providers={localProviders}
              selectedModel={reasoningModel}
              selectedProvider={selectedLocalProvider}
              onModelSelect={setReasoningModel}
              onProviderSelect={handleLocalProviderChange}
              modelType="llm"
              colorScheme="purple"
              onDownloadComplete={loadDownloadedModels}
            />
          )}
        </>
      )}
    </div>
  );
}
