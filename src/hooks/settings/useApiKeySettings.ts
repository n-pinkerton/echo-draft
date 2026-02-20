import { useCallback, useEffect, useRef } from "react";

import ReasoningService from "../../services/ReasoningService";
import logger from "../../utils/logger";
import { useDebouncedCallback } from "../useDebouncedCallback";
import { useLocalStorage } from "../useLocalStorage";
import type { ApiKeySettings } from "./settingsTypes";

type Provider = "openai" | "anthropic" | "gemini" | "groq" | "mistral" | "custom";

export function useApiKeySettings() {
  const [openaiApiKey, setOpenaiApiKeyLocal] = useLocalStorage("openaiApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  const [anthropicApiKey, setAnthropicApiKeyLocal] = useLocalStorage("anthropicApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  const [geminiApiKey, setGeminiApiKeyLocal] = useLocalStorage("geminiApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  const [groqApiKey, setGroqApiKeyLocal] = useLocalStorage("groqApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  const [mistralApiKey, setMistralApiKeyLocal] = useLocalStorage("mistralApiKey", "", {
    serialize: String,
    deserialize: String,
  });

  const [customTranscriptionApiKey, setCustomTranscriptionApiKeyLocal] = useLocalStorage(
    "customTranscriptionApiKey",
    "",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const [customReasoningApiKey, setCustomReasoningApiKeyLocal] = useLocalStorage(
    "customReasoningApiKey",
    "",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const hasRunApiKeySync = useRef(false);
  useEffect(() => {
    if (hasRunApiKeySync.current) return;
    hasRunApiKeySync.current = true;

    const syncKeys = async () => {
      if (typeof window === "undefined" || !window.electronAPI) return;

      if (!openaiApiKey) {
        const envKey = await window.electronAPI.getOpenAIKey?.();
        if (envKey) setOpenaiApiKeyLocal(envKey);
      }
      if (!anthropicApiKey) {
        const envKey = await window.electronAPI.getAnthropicKey?.();
        if (envKey) setAnthropicApiKeyLocal(envKey);
      }
      if (!geminiApiKey) {
        const envKey = await window.electronAPI.getGeminiKey?.();
        if (envKey) setGeminiApiKeyLocal(envKey);
      }
      if (!groqApiKey) {
        const envKey = await window.electronAPI.getGroqKey?.();
        if (envKey) setGroqApiKeyLocal(envKey);
      }
      if (!mistralApiKey) {
        const envKey = await window.electronAPI.getMistralKey?.();
        if (envKey) setMistralApiKeyLocal(envKey);
      }
      if (!customTranscriptionApiKey) {
        const envKey = await window.electronAPI.getCustomTranscriptionKey?.();
        if (envKey) setCustomTranscriptionApiKeyLocal(envKey);
      }
      if (!customReasoningApiKey) {
        const envKey = await window.electronAPI.getCustomReasoningKey?.();
        if (envKey) setCustomReasoningApiKeyLocal(envKey);
      }
    };

    syncKeys().catch((err) => {
      logger.warn(
        "Failed to sync API keys on startup",
        { error: (err as Error).message },
        "settings"
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const debouncedPersistToEnv = useDebouncedCallback(() => {
    if (typeof window !== "undefined" && window.electronAPI?.saveAllKeysToEnv) {
      window.electronAPI.saveAllKeysToEnv().catch((err) => {
        logger.warn(
          "Failed to persist API keys to .env",
          { error: (err as Error).message },
          "settings"
        );
      });
    }
  }, 1000);

  const invalidateApiKeyCaches = useCallback(
    (provider?: Provider) => {
      if (provider) {
        ReasoningService.clearApiKeyCache(provider);
      }
      window.dispatchEvent(new Event("api-key-changed"));
      debouncedPersistToEnv();
    },
    [debouncedPersistToEnv]
  );

  const setOpenaiApiKey = useCallback(
    (key: string) => {
      setOpenaiApiKeyLocal(key);
      window.electronAPI?.saveOpenAIKey?.(key);
      invalidateApiKeyCaches("openai");
    },
    [invalidateApiKeyCaches, setOpenaiApiKeyLocal]
  );

  const setAnthropicApiKey = useCallback(
    (key: string) => {
      setAnthropicApiKeyLocal(key);
      window.electronAPI?.saveAnthropicKey?.(key);
      invalidateApiKeyCaches("anthropic");
    },
    [invalidateApiKeyCaches, setAnthropicApiKeyLocal]
  );

  const setGeminiApiKey = useCallback(
    (key: string) => {
      setGeminiApiKeyLocal(key);
      window.electronAPI?.saveGeminiKey?.(key);
      invalidateApiKeyCaches("gemini");
    },
    [invalidateApiKeyCaches, setGeminiApiKeyLocal]
  );

  const setGroqApiKey = useCallback(
    (key: string) => {
      setGroqApiKeyLocal(key);
      window.electronAPI?.saveGroqKey?.(key);
      invalidateApiKeyCaches("groq");
    },
    [invalidateApiKeyCaches, setGroqApiKeyLocal]
  );

  const setMistralApiKey = useCallback(
    (key: string) => {
      setMistralApiKeyLocal(key);
      window.electronAPI?.saveMistralKey?.(key);
      invalidateApiKeyCaches("mistral");
    },
    [invalidateApiKeyCaches, setMistralApiKeyLocal]
  );

  const setCustomTranscriptionApiKey = useCallback(
    (key: string) => {
      setCustomTranscriptionApiKeyLocal(key);
      window.electronAPI?.saveCustomTranscriptionKey?.(key);
      invalidateApiKeyCaches();
    },
    [invalidateApiKeyCaches, setCustomTranscriptionApiKeyLocal]
  );

  const setCustomReasoningApiKey = useCallback(
    (key: string) => {
      setCustomReasoningApiKeyLocal(key);
      window.electronAPI?.saveCustomReasoningKey?.(key);
      invalidateApiKeyCaches("custom");
    },
    [invalidateApiKeyCaches, setCustomReasoningApiKeyLocal]
  );

  const updateApiKeys = useCallback(
    (keys: Partial<ApiKeySettings>) => {
      if (keys.openaiApiKey !== undefined) setOpenaiApiKey(keys.openaiApiKey);
      if (keys.anthropicApiKey !== undefined) setAnthropicApiKey(keys.anthropicApiKey);
      if (keys.geminiApiKey !== undefined) setGeminiApiKey(keys.geminiApiKey);
      if (keys.groqApiKey !== undefined) setGroqApiKey(keys.groqApiKey);
      if (keys.mistralApiKey !== undefined) setMistralApiKey(keys.mistralApiKey);
    },
    [setAnthropicApiKey, setGeminiApiKey, setGroqApiKey, setMistralApiKey, setOpenaiApiKey]
  );

  return {
    openaiApiKey,
    anthropicApiKey,
    geminiApiKey,
    groqApiKey,
    mistralApiKey,
    customTranscriptionApiKey,
    customReasoningApiKey,
    setOpenaiApiKey,
    setAnthropicApiKey,
    setGeminiApiKey,
    setGroqApiKey,
    setMistralApiKey,
    setCustomTranscriptionApiKey,
    setCustomReasoningApiKey,
    updateApiKeys,
  };
}

