import { useMemo } from "react";
import type { ComponentProps } from "react";
import type { default as TranscriptionModelPicker } from "../TranscriptionModelPicker";
import type { TranscriptionSettings } from "../../hooks/useSettings";
import type { LocalTranscriptionProvider } from "../../types/electron";

type TranscriptionPickerProps = Omit<ComponentProps<typeof TranscriptionModelPicker>, "variant">;

type UseGuestTranscriptionPickerPropsParams = {
  useLocalWhisper: boolean;
  whisperModel: string;
  parakeetModel: string;
  localTranscriptionProvider: string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionModel: string;
  cloudTranscriptionBaseUrl: string;
  openaiApiKey: string;
  setOpenaiApiKey: (value: string) => void;
  groqApiKey: string;
  setGroqApiKey: (value: string) => void;
  mistralApiKey: string;
  setMistralApiKey: (value: string) => void;
  customTranscriptionApiKey: string;
  setCustomTranscriptionApiKey: (value: string) => void;
  updateTranscriptionSettings: (partial: Partial<TranscriptionSettings>) => void;
};

export const useGuestTranscriptionPickerProps = (
  params: UseGuestTranscriptionPickerPropsParams
): TranscriptionPickerProps => {
  const {
    useLocalWhisper,
    whisperModel,
    parakeetModel,
    localTranscriptionProvider,
    cloudTranscriptionProvider,
    cloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    openaiApiKey,
    setOpenaiApiKey,
    groqApiKey,
    setGroqApiKey,
    mistralApiKey,
    setMistralApiKey,
    customTranscriptionApiKey,
    setCustomTranscriptionApiKey,
    updateTranscriptionSettings,
  } = params;

  return useMemo(
    () => ({
      selectedCloudProvider: cloudTranscriptionProvider,
      onCloudProviderSelect: (provider) =>
        updateTranscriptionSettings({ cloudTranscriptionProvider: provider }),
      selectedCloudModel: cloudTranscriptionModel,
      onCloudModelSelect: (model) => updateTranscriptionSettings({ cloudTranscriptionModel: model }),
      selectedLocalModel: localTranscriptionProvider === "nvidia" ? parakeetModel : whisperModel,
      onLocalModelSelect: (modelId) => {
        if (localTranscriptionProvider === "nvidia") {
          updateTranscriptionSettings({ parakeetModel: modelId });
        } else {
          updateTranscriptionSettings({ whisperModel: modelId });
        }
      },
      selectedLocalProvider: localTranscriptionProvider,
      onLocalProviderSelect: (provider: LocalTranscriptionProvider) =>
        updateTranscriptionSettings({ localTranscriptionProvider: provider }),
      useLocalWhisper,
      onModeChange: (isLocal) => updateTranscriptionSettings({ useLocalWhisper: isLocal }),
      openaiApiKey,
      setOpenaiApiKey,
      groqApiKey,
      setGroqApiKey,
      mistralApiKey,
      setMistralApiKey,
      customTranscriptionApiKey,
      setCustomTranscriptionApiKey,
      cloudTranscriptionBaseUrl,
      setCloudTranscriptionBaseUrl: (url) =>
        updateTranscriptionSettings({ cloudTranscriptionBaseUrl: url }),
    }),
    [
      cloudTranscriptionBaseUrl,
      cloudTranscriptionModel,
      cloudTranscriptionProvider,
      customTranscriptionApiKey,
      groqApiKey,
      localTranscriptionProvider,
      mistralApiKey,
      openaiApiKey,
      parakeetModel,
      setCustomTranscriptionApiKey,
      setGroqApiKey,
      setMistralApiKey,
      setOpenaiApiKey,
      updateTranscriptionSettings,
      useLocalWhisper,
      whisperModel,
    ]
  );
};
