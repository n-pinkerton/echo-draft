import { useState, useEffect, useCallback, useMemo } from "react";
import { ConfirmDialog } from "./ui/dialog";
import { useDialogs } from "../hooks/useDialogs";
import { useModelDownload } from "../hooks/useModelDownload";
import { getTranscriptionProviders, TranscriptionProviderData } from "../models/ModelRegistry";
import {
  MODEL_PICKER_COLORS,
  type ColorScheme,
  type ModelPickerStyles,
} from "../utils/modelPickerStyles";
import { getProviderIcon, isMonochromeProvider } from "../utils/providerIcons";
import { API_ENDPOINTS, normalizeBaseUrl } from "../config/constants";
import { ModeToggle } from "./transcriptionModelPicker/ModeToggle";
import {
  LOCAL_PROVIDER_TABS,
  VALID_CLOUD_PROVIDER_IDS,
} from "./transcriptionModelPicker/constants";
import CloudModePanel from "./transcriptionModelPicker/cloud/CloudModePanel";
import LocalModePanel from "./transcriptionModelPicker/local/LocalModePanel";
import { useParakeetModels } from "./transcriptionModelPicker/hooks/useParakeetModels";
import { useWhisperModels } from "./transcriptionModelPicker/hooks/useWhisperModels";
import { normalizeCustomEndpointOutcome, type CustomEndpointSetter } from "../types/customEndpoint";
import type { LocalTranscriptionProvider } from "../types/electron";

interface TranscriptionModelPickerProps {
  selectedCloudProvider: string;
  onCloudProviderSelect: (providerId: string) => void;
  selectedCloudModel: string;
  onCloudModelSelect: (modelId: string) => void;
  selectedLocalModel: string;
  onLocalModelSelect: (modelId: string) => void;
  selectedLocalProvider?: string;
  onLocalProviderSelect?: (providerId: LocalTranscriptionProvider) => void;
  useLocalWhisper: boolean;
  onModeChange: (useLocal: boolean) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  mistralApiKey: string;
  setMistralApiKey: (key: string) => void;
  customTranscriptionApiKey?: string;
  setCustomTranscriptionApiKey?: (key: string) => void;
  cloudTranscriptionBaseUrl?: string;
  setCloudTranscriptionBaseUrl?: CustomEndpointSetter;
  className?: string;
  variant?: "onboarding" | "settings";
}

export default function TranscriptionModelPicker({
  selectedCloudProvider,
  onCloudProviderSelect,
  selectedCloudModel,
  onCloudModelSelect,
  selectedLocalModel,
  onLocalModelSelect,
  selectedLocalProvider = "whisper",
  onLocalProviderSelect,
  useLocalWhisper,
  onModeChange,
  openaiApiKey,
  setOpenaiApiKey,
  groqApiKey,
  setGroqApiKey,
  mistralApiKey,
  setMistralApiKey,
  customTranscriptionApiKey = "",
  setCustomTranscriptionApiKey,
  cloudTranscriptionBaseUrl = "",
  setCloudTranscriptionBaseUrl,
  className = "",
  variant = "settings",
}: TranscriptionModelPickerProps) {
  const [internalLocalProvider, setInternalLocalProvider] = useState(selectedLocalProvider);
  const [customBaseInput, setCustomBaseInput] = useState(cloudTranscriptionBaseUrl);
  const [customBaseError, setCustomBaseError] = useState<string | null>(null);

  // Sync internal state with prop when it changes externally
  useEffect(() => {
    setInternalLocalProvider(selectedLocalProvider);
  }, [selectedLocalProvider]);

  useEffect(() => {
    setCustomBaseInput(cloudTranscriptionBaseUrl);
  }, [cloudTranscriptionBaseUrl]);

  const whisperModelsEnabled = useLocalWhisper && internalLocalProvider === "whisper";
  const parakeetModelsEnabled = useLocalWhisper && internalLocalProvider === "nvidia";

  const { models: localModels, reload: loadLocalModels } = useWhisperModels({
    enabled: whisperModelsEnabled,
    selectedModel: selectedLocalModel,
    onSelectModel: onLocalModelSelect,
  });

  const { models: parakeetModels, reload: loadParakeetModels } = useParakeetModels({
    enabled: parakeetModelsEnabled,
  });

  const { confirmDialog, showConfirmDialog, hideConfirmDialog } = useDialogs();
  const colorScheme: ColorScheme = variant === "settings" ? "purple" : "blue";
  const styles = useMemo(() => MODEL_PICKER_COLORS[colorScheme], [colorScheme]);
  const cloudProviders = useMemo(() => getTranscriptionProviders(), []);

  const ensureValidCloudSelection = useCallback(() => {
    const isValidProvider = (VALID_CLOUD_PROVIDER_IDS as readonly string[]).includes(
      selectedCloudProvider
    );

    if (!isValidProvider) {
      // Check if we have a custom URL that differs from known providers
      const knownProviderUrls = cloudProviders.map((p) => p.baseUrl);
      const hasCustomUrl =
        cloudTranscriptionBaseUrl &&
        cloudTranscriptionBaseUrl.trim() !== "" &&
        cloudTranscriptionBaseUrl !== API_ENDPOINTS.TRANSCRIPTION_BASE &&
        !knownProviderUrls.includes(cloudTranscriptionBaseUrl);

      if (hasCustomUrl) {
        onCloudProviderSelect("custom");
      } else {
        const firstProvider = cloudProviders[0];
        if (firstProvider) {
          onCloudProviderSelect(firstProvider.id);
          if (firstProvider.models?.length) {
            onCloudModelSelect(firstProvider.models[0].id);
          }
        }
      }
    } else if (selectedCloudProvider !== "custom" && !selectedCloudModel) {
      const provider = cloudProviders.find((p) => p.id === selectedCloudProvider);
      if (provider?.models?.length) {
        onCloudModelSelect(provider.models[0].id);
      }
    }
  }, [
    cloudProviders,
    cloudTranscriptionBaseUrl,
    selectedCloudProvider,
    selectedCloudModel,
    onCloudProviderSelect,
    onCloudModelSelect,
  ]);

  useEffect(() => {
    if (useLocalWhisper) return;
    ensureValidCloudSelection();
  }, [ensureValidCloudSelection, useLocalWhisper]);

  const {
    downloadingModel,
    downloadProgress,
    downloadModel,
    deleteModel,
    isDownloadingModel,
    isInstalling,
    cancelDownload,
    isCancelling,
  } = useModelDownload({
    modelType: "whisper",
    onDownloadComplete: () => void loadLocalModels(),
  });

  const {
    downloadingModel: downloadingParakeetModel,
    downloadProgress: parakeetDownloadProgress,
    downloadModel: downloadParakeetModel,
    deleteModel: deleteParakeetModel,
    isDownloadingModel: isDownloadingParakeetModel,
    isInstalling: isInstallingParakeet,
    cancelDownload: cancelParakeetDownload,
    isCancelling: isCancellingParakeet,
  } = useModelDownload({
    modelType: "parakeet",
    onDownloadComplete: () => void loadParakeetModels(),
  });

  const handleModeChange = useCallback(
    (isLocal: boolean) => {
      onModeChange(isLocal);
      if (!isLocal) ensureValidCloudSelection();
    },
    [onModeChange, ensureValidCloudSelection]
  );

  const handleCloudProviderChange = useCallback(
    (providerId: string) => {
      onCloudProviderSelect(providerId);
      const provider = cloudProviders.find((p) => p.id === providerId);

      if (providerId === "custom") {
        // Clear model to whisper-1 (standard fallback) to avoid sending
        // provider-specific models to custom endpoints
        onCloudModelSelect("whisper-1");
        setCustomBaseInput(cloudTranscriptionBaseUrl);
        // Don't change base URL - user will enter their own
        return;
      }

      if (provider) {
        // Update base URL to the selected provider's default
        setCloudTranscriptionBaseUrl?.(provider.baseUrl);
        if (provider.models?.length) {
          onCloudModelSelect(provider.models[0].id);
        }
      }
    },
    [
      cloudProviders,
      cloudTranscriptionBaseUrl,
      onCloudProviderSelect,
      onCloudModelSelect,
      setCloudTranscriptionBaseUrl,
    ]
  );

  const handleLocalProviderChange = useCallback(
    (providerId: string) => {
      const tab = LOCAL_PROVIDER_TABS.find((t) => t.id === providerId);
      if (tab?.disabled) return;
      if (providerId !== "whisper" && providerId !== "nvidia") return;
      setInternalLocalProvider(providerId);
      onLocalProviderSelect?.(providerId);
    },
    [onLocalProviderSelect]
  );

  // Wrapper to set both model and provider when selecting a local model
  const handleWhisperModelSelect = useCallback(
    (modelId: string) => {
      onLocalProviderSelect?.("whisper");
      setInternalLocalProvider("whisper");
      onLocalModelSelect(modelId);
    },
    [onLocalModelSelect, onLocalProviderSelect]
  );

  const handleParakeetModelSelect = useCallback(
    (modelId: string) => {
      onLocalProviderSelect?.("nvidia");
      setInternalLocalProvider("nvidia");
      onLocalModelSelect(modelId);
    },
    [onLocalModelSelect, onLocalProviderSelect]
  );

  const handleBaseUrlBlur = useCallback(async () => {
    if (!setCloudTranscriptionBaseUrl || selectedCloudProvider !== "custom") return;

    const trimmed = customBaseInput.trim();
    if (!trimmed) {
      setCustomBaseError("Enter an endpoint URL before leaving this field.");
      return;
    }

    const normalized = normalizeBaseUrl(trimmed);
    setCustomBaseInput(normalized);

    // Auto-detect if this matches a known provider
    if (normalized) {
      for (const provider of cloudProviders) {
        const providerNormalized = normalizeBaseUrl(provider.baseUrl);
        if (normalized === providerNormalized) {
          onCloudProviderSelect(provider.id);
          const outcome = normalizeCustomEndpointOutcome(
            await setCloudTranscriptionBaseUrl(normalized),
            normalized
          );
          if (outcome.status !== "approved") {
            setCustomBaseError(outcome.message);
            return;
          }
          setCustomBaseError(null);
          onCloudModelSelect("whisper-1");
          return;
        }
      }
    }

    let outcome;
    try {
      outcome = normalizeCustomEndpointOutcome(
        await setCloudTranscriptionBaseUrl(normalized),
        normalized
      );
    } catch {
      outcome = {
        status: "error" as const,
        message: "EchoDraft could not approve this endpoint. Check the URL and try again.",
      };
    }
    if (outcome.status !== "approved") {
      setCustomBaseError(outcome.message);
      return;
    }
    setCustomBaseError(null);
    setCustomBaseInput(outcome.endpoint);
  }, [
    customBaseInput,
    selectedCloudProvider,
    setCloudTranscriptionBaseUrl,
    onCloudProviderSelect,
    onCloudModelSelect,
    cloudProviders,
  ]);

  const handleDelete = useCallback(
    (modelId: string) => {
      showConfirmDialog({
        title: "Delete Model",
        description:
          "Are you sure you want to delete this model? You'll need to re-download it if you want to use it again.",
        onConfirm: async () => {
          await deleteModel(modelId, () => void loadLocalModels());
        },
        variant: "destructive",
      });
    },
    [showConfirmDialog, deleteModel, loadLocalModels]
  );

  const currentCloudProvider = useMemo<TranscriptionProviderData | undefined>(
    () => cloudProviders.find((p) => p.id === selectedCloudProvider),
    [cloudProviders, selectedCloudProvider]
  );

  const cloudModelOptions = useMemo(() => {
    if (!currentCloudProvider) return [];
    return currentCloudProvider.models.map((m) => ({
      value: m.id,
      label: m.name,
      description: m.description,
      icon: getProviderIcon(selectedCloudProvider),
      invertInDark: isMonochromeProvider(selectedCloudProvider),
    }));
  }, [currentCloudProvider, selectedCloudProvider]);

  const handleParakeetDelete = useCallback(
    (modelId: string) => {
      showConfirmDialog({
        title: "Delete Model",
        description:
          "Are you sure you want to delete this model? You'll need to re-download it if you want to use it again.",
        onConfirm: async () => {
          await deleteParakeetModel(modelId, () => void loadParakeetModels());
        },
        variant: "destructive",
      });
    },
    [showConfirmDialog, deleteParakeetModel, loadParakeetModels]
  );

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Integrated mode toggle - always visible */}
      <ModeToggle useLocalWhisper={useLocalWhisper} onModeChange={handleModeChange} />

      {!useLocalWhisper ? (
        <CloudModePanel
          styles={styles}
          tabColorScheme={colorScheme === "purple" ? "purple" : "indigo"}
          selectedCloudProvider={selectedCloudProvider}
          selectedCloudModel={selectedCloudModel}
          onCloudProviderChange={handleCloudProviderChange}
          onCloudModelSelect={onCloudModelSelect}
          cloudModelOptions={cloudModelOptions}
          cloudTranscriptionBaseUrl={
            selectedCloudProvider === "custom" ? customBaseInput : cloudTranscriptionBaseUrl
          }
          setCloudTranscriptionBaseUrl={(value) => {
            setCustomBaseInput(value);
            setCustomBaseError(null);
          }}
          customEndpointError={customBaseError}
          onBaseUrlBlur={handleBaseUrlBlur}
          openaiApiKey={openaiApiKey}
          setOpenaiApiKey={setOpenaiApiKey}
          groqApiKey={groqApiKey}
          setGroqApiKey={setGroqApiKey}
          mistralApiKey={mistralApiKey}
          setMistralApiKey={setMistralApiKey}
          customTranscriptionApiKey={customTranscriptionApiKey}
          setCustomTranscriptionApiKey={setCustomTranscriptionApiKey}
        />
      ) : (
        <LocalModePanel
          styles={styles}
          tabColorScheme={colorScheme === "purple" ? "purple" : "indigo"}
          internalLocalProvider={internalLocalProvider}
          onLocalProviderChange={handleLocalProviderChange}
          useLocalWhisper={useLocalWhisper}
          selectedLocalModel={selectedLocalModel}
          localModels={localModels}
          parakeetModels={parakeetModels}
          downloadingModel={downloadingModel}
          downloadProgress={downloadProgress}
          isInstalling={isInstalling}
          downloadingParakeetModel={downloadingParakeetModel}
          parakeetDownloadProgress={parakeetDownloadProgress}
          isInstallingParakeet={isInstallingParakeet}
          isDownloadingModel={isDownloadingModel}
          isCancelling={isCancelling}
          downloadModel={downloadModel}
          cancelDownload={cancelDownload}
          isDownloadingParakeetModel={isDownloadingParakeetModel}
          isCancellingParakeet={isCancellingParakeet}
          downloadParakeetModel={downloadParakeetModel}
          cancelParakeetDownload={cancelParakeetDownload}
          onWhisperModelSelect={handleWhisperModelSelect}
          onWhisperModelDelete={handleDelete}
          onParakeetModelSelect={handleParakeetModelSelect}
          onParakeetModelDelete={handleParakeetDelete}
        />
      )}

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />
    </div>
  );
}
