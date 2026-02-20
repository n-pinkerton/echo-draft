import type { LocalTranscriptionProvider } from "../../types/electron";

export interface TranscriptionSettings {
  useLocalWhisper: boolean;
  whisperModel: string;
  localTranscriptionProvider: LocalTranscriptionProvider;
  parakeetModel: string;
  allowOpenAIFallback: boolean;
  allowLocalFallback: boolean;
  fallbackWhisperModel: string;
  preferredLanguage: string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionModel: string;
  cloudTranscriptionBaseUrl?: string;
  cloudTranscriptionMode: string;
  customDictionary: string[];
  assemblyAiStreaming: boolean;
}

export interface ReasoningSettings {
  useReasoningModel: boolean;
  reasoningModel: string;
  reasoningProvider: string;
  cloudReasoningBaseUrl?: string;
  cloudReasoningMode: string;
}

export interface HotkeySettings {
  dictationKey: string;
  dictationKeyClipboard: string;
  activationMode: "tap" | "push";
}

export interface MicrophoneSettings {
  preferBuiltInMic: boolean;
  selectedMicDeviceId: string;
}

export interface ApiKeySettings {
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  groqApiKey: string;
  mistralApiKey: string;
  customTranscriptionApiKey: string;
  customReasoningApiKey: string;
}

export interface PrivacySettings {
  cloudBackupEnabled: boolean;
  telemetryEnabled: boolean;
}

export interface ThemeSettings {
  theme: "light" | "dark" | "auto";
}

