import { useCallback, useEffect, useRef } from "react";

import { API_ENDPOINTS } from "../../config/constants";
import logger from "../../utils/logger";
import type { LocalTranscriptionProvider } from "../../types/electron";
import { useLocalStorage } from "../useLocalStorage";
import type { TranscriptionSettings } from "./settingsTypes";
import { syncDictionaryOnStartup } from "./dictionarySync";

const deserializeLocalProvider = (value: string): LocalTranscriptionProvider =>
  value === "nvidia" ? "nvidia" : "whisper";

export function useTranscriptionSettings() {
  const [useLocalWhisper, setUseLocalWhisper] = useLocalStorage("useLocalWhisper", false, {
    serialize: String,
    deserialize: (value) => value === "true",
  });

  const [whisperModel, setWhisperModel] = useLocalStorage("whisperModel", "base", {
    serialize: String,
    deserialize: String,
  });

  const [localTranscriptionProvider, setLocalTranscriptionProvider] =
    useLocalStorage<LocalTranscriptionProvider>("localTranscriptionProvider", "whisper", {
      serialize: String,
      deserialize: deserializeLocalProvider,
    });

  const [parakeetModel, setParakeetModel] = useLocalStorage("parakeetModel", "", {
    serialize: String,
    deserialize: String,
  });

  const [allowOpenAIFallback, setAllowOpenAIFallback] = useLocalStorage(
    "allowOpenAIFallback",
    false,
    {
      serialize: String,
      deserialize: (value) => value === "true",
    }
  );

  const [allowLocalFallback, setAllowLocalFallback] = useLocalStorage("allowLocalFallback", false, {
    serialize: String,
    deserialize: (value) => value === "true",
  });

  const [fallbackWhisperModel, setFallbackWhisperModel] = useLocalStorage(
    "fallbackWhisperModel",
    "base",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [preferredLanguage, setPreferredLanguage] = useLocalStorage("preferredLanguage", "auto", {
    serialize: String,
    deserialize: String,
  });

  const [cloudTranscriptionProvider, setCloudTranscriptionProvider] = useLocalStorage(
    "cloudTranscriptionProvider",
    "openai",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [cloudTranscriptionModel, setCloudTranscriptionModel] = useLocalStorage(
    "cloudTranscriptionModel",
    "gpt-4o-mini-transcribe",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [cloudTranscriptionBaseUrl, setCloudTranscriptionBaseUrl] = useLocalStorage(
    "cloudTranscriptionBaseUrl",
    API_ENDPOINTS.TRANSCRIPTION_BASE,
    {
      serialize: String,
      deserialize: String,
    }
  );

  // Cloud transcription mode: "openwhispr" (server-side) or "byok" (bring your own key)
  const [cloudTranscriptionMode, setCloudTranscriptionMode] = useLocalStorage(
    "cloudTranscriptionMode",
    "openwhispr",
    {
      serialize: String,
      deserialize: String,
    }
  );

  // Custom dictionary for improving transcription of specific words
  const [customDictionary, setCustomDictionaryRaw] = useLocalStorage<string[]>(
    "customDictionary",
    [],
    {
      serialize: JSON.stringify,
      deserialize: (value) => {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      },
    }
  );

  // Assembly AI real-time streaming (enabled by default for signed-in users)
  const [assemblyAiStreaming, setAssemblyAiStreaming] = useLocalStorage(
    "assemblyAiStreaming",
    true,
    {
      serialize: String,
      deserialize: (value) => value !== "false",
    }
  );

  const setCustomDictionary = useCallback(
    (words: string[]) => {
      setCustomDictionaryRaw(words);
      window.electronAPI?.setDictionary(words).catch((err) => {
        logger.warn(
          "Failed to sync dictionary to SQLite",
          { error: (err as Error).message },
          "settings"
        );
      });
    },
    [setCustomDictionaryRaw]
  );

  const hasRunDictionarySync = useRef(false);
  useEffect(() => {
    if (hasRunDictionarySync.current) return;
    hasRunDictionarySync.current = true;

    syncDictionaryOnStartup({
      electronAPI: typeof window !== "undefined" ? window.electronAPI : null,
      localWords: customDictionary,
      setLocalWords: setCustomDictionaryRaw,
      log: logger,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateTranscriptionSettings = useCallback(
    (settings: Partial<TranscriptionSettings>) => {
      if (settings.useLocalWhisper !== undefined) setUseLocalWhisper(settings.useLocalWhisper);
      if (settings.whisperModel !== undefined) setWhisperModel(settings.whisperModel);
      if (settings.localTranscriptionProvider !== undefined)
        setLocalTranscriptionProvider(settings.localTranscriptionProvider);
      if (settings.parakeetModel !== undefined) setParakeetModel(settings.parakeetModel);
      if (settings.allowOpenAIFallback !== undefined)
        setAllowOpenAIFallback(settings.allowOpenAIFallback);
      if (settings.allowLocalFallback !== undefined)
        setAllowLocalFallback(settings.allowLocalFallback);
      if (settings.fallbackWhisperModel !== undefined)
        setFallbackWhisperModel(settings.fallbackWhisperModel);
      if (settings.preferredLanguage !== undefined)
        setPreferredLanguage(settings.preferredLanguage);
      if (settings.cloudTranscriptionProvider !== undefined)
        setCloudTranscriptionProvider(settings.cloudTranscriptionProvider);
      if (settings.cloudTranscriptionModel !== undefined)
        setCloudTranscriptionModel(settings.cloudTranscriptionModel);
      if (settings.cloudTranscriptionBaseUrl !== undefined)
        setCloudTranscriptionBaseUrl(settings.cloudTranscriptionBaseUrl);
      if (settings.customDictionary !== undefined) setCustomDictionary(settings.customDictionary);
    },
    [
      setAllowLocalFallback,
      setAllowOpenAIFallback,
      setCloudTranscriptionBaseUrl,
      setCloudTranscriptionModel,
      setCloudTranscriptionProvider,
      setCustomDictionary,
      setFallbackWhisperModel,
      setLocalTranscriptionProvider,
      setParakeetModel,
      setPreferredLanguage,
      setUseLocalWhisper,
      setWhisperModel,
    ]
  );

  return {
    useLocalWhisper,
    whisperModel,
    localTranscriptionProvider,
    parakeetModel,
    allowOpenAIFallback,
    allowLocalFallback,
    fallbackWhisperModel,
    preferredLanguage,
    cloudTranscriptionProvider,
    cloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    cloudTranscriptionMode,
    customDictionary,
    assemblyAiStreaming,
    setAssemblyAiStreaming,
    setUseLocalWhisper,
    setWhisperModel,
    setLocalTranscriptionProvider,
    setParakeetModel,
    setAllowOpenAIFallback,
    setAllowLocalFallback,
    setFallbackWhisperModel,
    setPreferredLanguage,
    setCloudTranscriptionProvider,
    setCloudTranscriptionModel,
    setCloudTranscriptionBaseUrl,
    setCloudTranscriptionMode,
    setCustomDictionary,
    updateTranscriptionSettings,
  };
}

