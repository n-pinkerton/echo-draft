import { useTranscriptionSettings } from "./settings/useTranscriptionSettings";
import { useReasoningSettings } from "./settings/useReasoningSettings";
import { useApiKeySettings } from "./settings/useApiKeySettings";
import { useHotkeySettings } from "./settings/useHotkeySettings";
import { useMicrophoneSettings } from "./settings/useMicrophoneSettings";
import { usePrivacySettings } from "./settings/usePrivacySettings";
import { useThemeSettings } from "./settings/useThemeSettings";
import { useStartupPreferencesSync } from "./settings/useStartupPreferencesSync";

export type {
  ApiKeySettings,
  HotkeySettings,
  MicrophoneSettings,
  PrivacySettings,
  ReasoningSettings,
  ThemeSettings,
  TranscriptionSettings,
} from "./settings/settingsTypes";

export function useSettings() {
  const transcription = useTranscriptionSettings();
  const reasoning = useReasoningSettings();
  const apiKeys = useApiKeySettings();
  const hotkeys = useHotkeySettings();
  const microphone = useMicrophoneSettings();
  const privacy = usePrivacySettings();
  const theme = useThemeSettings();

  useStartupPreferencesSync({
    useLocalWhisper: transcription.useLocalWhisper,
    localTranscriptionProvider: transcription.localTranscriptionProvider,
    whisperModel: transcription.whisperModel,
    parakeetModel: transcription.parakeetModel,
    reasoningProvider: reasoning.reasoningProvider,
    reasoningModel: reasoning.reasoningModel,
  });

  return {
    ...transcription,
    ...reasoning,
    ...apiKeys,
    ...hotkeys,
    ...microphone,
    ...privacy,
    ...theme,
  };
}
