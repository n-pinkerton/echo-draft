import { useCallback, useEffect, useRef } from "react";

import { API_ENDPOINTS } from "../../config/constants";
import { ECHO_DRAFT_CLOUD_MODE, normalizeCloudMode } from "../../utils/branding";
import logger from "../../utils/logger";
import type { LocalTranscriptionProvider } from "../../types/electron";
import type { CustomEndpointApprovalOutcome } from "../../types/customEndpoint";
import { useLocalStorage } from "../useLocalStorage";
import type { TranscriptionSettings } from "./settingsTypes";
import { syncDictionaryOnStartup } from "./dictionarySync";
import {
  MAX_STORED_DICTIONARY_ENTRIES,
  sanitizeLexicalDictionaryEntries,
} from "../../utils/dictionaryLexicon.cjs";

const deserializeLocalProvider = (value: string): LocalTranscriptionProvider =>
  value === "nvidia" ? "nvidia" : "whisper";
const sanitizeCustomDictionary = (words: unknown): string[] =>
  sanitizeLexicalDictionaryEntries(Array.isArray(words) ? words : [], {
    maxEntries: MAX_STORED_DICTIONARY_ENTRIES,
    maxEntryLength: 80,
    maxWords: 1,
  });

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

  const [cloudTranscriptionProvider, setCloudTranscriptionProviderStored] = useLocalStorage(
    "cloudTranscriptionProvider",
    "openai",
    {
      serialize: String,
      deserialize: String,
    }
  );
  const cloudTranscriptionProviderRef = useRef(cloudTranscriptionProvider);
  const setCloudTranscriptionProvider = useCallback(
    (value: string) => {
      cloudTranscriptionProviderRef.current = value;
      setCloudTranscriptionProviderStored(value);
    },
    [setCloudTranscriptionProviderStored]
  );

  useEffect(() => {
    cloudTranscriptionProviderRef.current = cloudTranscriptionProvider;
  }, [cloudTranscriptionProvider]);

  const [cloudTranscriptionModel, setCloudTranscriptionModel] = useLocalStorage(
    "cloudTranscriptionModel",
    "gpt-4o-transcribe",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [cloudTranscriptionBaseUrl, setCloudTranscriptionBaseUrlStored] = useLocalStorage(
    "cloudTranscriptionBaseUrl",
    API_ENDPOINTS.TRANSCRIPTION_BASE,
    {
      serialize: String,
      deserialize: String,
    }
  );
  const endpointApprovalSequence = useRef(0);

  const setCloudTranscriptionBaseUrl = useCallback(
    async (value: string): Promise<CustomEndpointApprovalOutcome> => {
      const sequence = ++endpointApprovalSequence.current;
      if (cloudTranscriptionProviderRef.current !== "custom") {
        setCloudTranscriptionBaseUrlStored(value);
        return { status: "approved", endpoint: value };
      }

      const approve = window.electronAPI?.approveCustomProviderEndpoint;
      if (!approve) {
        logger.warn("Secure custom transcription endpoint approval is unavailable", {}, "settings");
        return {
          status: "error",
          message:
            "Secure custom endpoint approval is unavailable. Restart or reinstall EchoDraft.",
        };
      }
      try {
        const result = await approve("transcription", value);
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
        setCloudTranscriptionBaseUrlStored(result.endpoint);
        return { status: "approved", endpoint: result.endpoint };
      } catch (error) {
        if (sequence === endpointApprovalSequence.current) {
          logger.warn(
            "Custom transcription endpoint was not approved",
            { error: (error as Error).message },
            "settings"
          );
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
    [setCloudTranscriptionBaseUrlStored]
  );

  // Cloud transcription mode: "echodraft" (server-side) or "byok" (bring your own key)
  const [cloudTranscriptionMode, setCloudTranscriptionMode] = useLocalStorage(
    "cloudTranscriptionMode",
    ECHO_DRAFT_CLOUD_MODE,
    {
      serialize: String,
      deserialize: (value) => normalizeCloudMode(String(value)),
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
          return sanitizeCustomDictionary(parsed);
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
      const safeWords = sanitizeCustomDictionary(words);
      setCustomDictionaryRaw(safeWords);
      window.electronAPI?.setDictionary(safeWords).catch((err) => {
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
      setLocalWords: (words) => setCustomDictionaryRaw(sanitizeCustomDictionary(words)),
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
