import { useCallback, useEffect, useRef, useState } from "react";

import { SAVED_KEY_PLACEHOLDER } from "../../config/apiKeys";
import ReasoningService from "../../services/ReasoningService";
import logger from "../../utils/logger";
import type { ApiKeySettings } from "./settingsTypes";

type Provider = "openai" | "anthropic" | "gemini" | "groq" | "mistral" | "custom";
type KeyStatus = Awaited<ReturnType<Window["electronAPI"]["getApiKeyStatus"]>>;
type KeySaveResult = { success: boolean };

const LEGACY_STORAGE_KEYS = [
  "openaiApiKey",
  "anthropicApiKey",
  "geminiApiKey",
  "groqApiKey",
  "mistralApiKey",
  "customTranscriptionApiKey",
  "customReasoningApiKey",
] as const;

export function useApiKeySettings() {
  const [openaiApiKey, setOpenaiApiKeyLocal] = useState("");
  const [anthropicApiKey, setAnthropicApiKeyLocal] = useState("");
  const [geminiApiKey, setGeminiApiKeyLocal] = useState("");
  const [groqApiKey, setGroqApiKeyLocal] = useState("");
  const [mistralApiKey, setMistralApiKeyLocal] = useState("");
  const [customTranscriptionApiKey, setCustomTranscriptionApiKeyLocal] = useState("");
  const [customReasoningApiKey, setCustomReasoningApiKeyLocal] = useState("");

  const applyStatus = useCallback((status: KeyStatus) => {
    setOpenaiApiKeyLocal(status.openai ? SAVED_KEY_PLACEHOLDER : "");
    setAnthropicApiKeyLocal(status.anthropic ? SAVED_KEY_PLACEHOLDER : "");
    setGeminiApiKeyLocal(status.gemini ? SAVED_KEY_PLACEHOLDER : "");
    setGroqApiKeyLocal(status.groq ? SAVED_KEY_PLACEHOLDER : "");
    setMistralApiKeyLocal(status.mistral ? SAVED_KEY_PLACEHOLDER : "");
    setCustomTranscriptionApiKeyLocal(status.customTranscription ? SAVED_KEY_PLACEHOLDER : "");
    setCustomReasoningApiKeyLocal(status.customReasoning ? SAVED_KEY_PLACEHOLDER : "");
  }, []);

  const hasRunApiKeySync = useRef(false);
  useEffect(() => {
    if (hasRunApiKeySync.current) return;
    hasRunApiKeySync.current = true;

    const syncKeys = async () => {
      if (typeof window === "undefined" || !window.electronAPI?.getApiKeyStatus) return;
      const api = window.electronAPI;
      const status = await api.getApiKeyStatus();
      const legacy = Object.fromEntries(
        LEGACY_STORAGE_KEYS.map((key) => [key, window.localStorage.getItem(key) || ""])
      );
      const migrations: Array<
        [
          (typeof LEGACY_STORAGE_KEYS)[number],
          boolean,
          string,
          ((key: string) => Promise<KeySaveResult>) | undefined,
        ]
      > = [
        ["openaiApiKey", status.openai, legacy.openaiApiKey, api.saveOpenAIKey],
        ["anthropicApiKey", status.anthropic, legacy.anthropicApiKey, api.saveAnthropicKey],
        ["geminiApiKey", status.gemini, legacy.geminiApiKey, api.saveGeminiKey],
        ["groqApiKey", status.groq, legacy.groqApiKey, api.saveGroqKey],
        ["mistralApiKey", status.mistral, legacy.mistralApiKey, api.saveMistralKey],
        [
          "customTranscriptionApiKey",
          status.customTranscription,
          legacy.customTranscriptionApiKey,
          api.saveCustomTranscriptionKey,
        ],
        [
          "customReasoningApiKey",
          status.customReasoning,
          legacy.customReasoningApiKey,
          api.saveCustomReasoningKey,
        ],
      ];
      for (const [storageKey, alreadyStored, value, save] of migrations) {
        if (!alreadyStored && value && value !== SAVED_KEY_PLACEHOLDER && save) {
          // Migration is bounded to a legacy key already present on this device.
          const result = await save(value);
          if (result?.success !== true) {
            throw new Error("A legacy API key could not be moved to secure storage.");
          }
        }
        window.localStorage.removeItem(storageKey);
      }
      applyStatus(await api.getApiKeyStatus());
    };

    syncKeys().catch((err) => {
      logger.warn(
        "Failed to migrate API key settings",
        { error: (err as Error).message },
        "settings"
      );
    });
  }, [applyStatus]);

  const invalidateApiKeyCaches = useCallback((provider?: Provider) => {
    if (provider) ReasoningService.clearApiKeyCache(provider);
    window.dispatchEvent(new Event("api-key-changed"));
  }, []);

  const persist = useCallback(
    async (
      key: string,
      setLocal: (value: string) => void,
      save: ((value: string) => Promise<KeySaveResult>) | undefined,
      provider?: Provider
    ): Promise<void> => {
      if (key === SAVED_KEY_PLACEHOLDER) return;
      if (!save) throw new Error("Secure API key storage is unavailable.");
      const result = await save(key);
      if (result?.success !== true) {
        throw new Error("The API key could not be saved.");
      }
      setLocal(key ? SAVED_KEY_PLACEHOLDER : "");
      invalidateApiKeyCaches(provider);
    },
    [invalidateApiKeyCaches]
  );

  const setOpenaiApiKey = useCallback(
    (key: string) =>
      persist(key, setOpenaiApiKeyLocal, window.electronAPI?.saveOpenAIKey, "openai"),
    [persist]
  );
  const setAnthropicApiKey = useCallback(
    (key: string) =>
      persist(key, setAnthropicApiKeyLocal, window.electronAPI?.saveAnthropicKey, "anthropic"),
    [persist]
  );
  const setGeminiApiKey = useCallback(
    (key: string) =>
      persist(key, setGeminiApiKeyLocal, window.electronAPI?.saveGeminiKey, "gemini"),
    [persist]
  );
  const setGroqApiKey = useCallback(
    (key: string) => persist(key, setGroqApiKeyLocal, window.electronAPI?.saveGroqKey, "groq"),
    [persist]
  );
  const setMistralApiKey = useCallback(
    (key: string) =>
      persist(key, setMistralApiKeyLocal, window.electronAPI?.saveMistralKey, "mistral"),
    [persist]
  );
  const setCustomTranscriptionApiKey = useCallback(
    (key: string) =>
      persist(
        key,
        setCustomTranscriptionApiKeyLocal,
        window.electronAPI?.saveCustomTranscriptionKey
      ),
    [persist]
  );
  const setCustomReasoningApiKey = useCallback(
    (key: string) =>
      persist(
        key,
        setCustomReasoningApiKeyLocal,
        window.electronAPI?.saveCustomReasoningKey,
        "custom"
      ),
    [persist]
  );

  const updateApiKeys = useCallback(
    async (keys: Partial<ApiKeySettings>): Promise<void> => {
      const updates: Promise<void>[] = [];
      if (keys.openaiApiKey !== undefined) updates.push(setOpenaiApiKey(keys.openaiApiKey));
      if (keys.anthropicApiKey !== undefined)
        updates.push(setAnthropicApiKey(keys.anthropicApiKey));
      if (keys.geminiApiKey !== undefined) updates.push(setGeminiApiKey(keys.geminiApiKey));
      if (keys.groqApiKey !== undefined) updates.push(setGroqApiKey(keys.groqApiKey));
      if (keys.mistralApiKey !== undefined) updates.push(setMistralApiKey(keys.mistralApiKey));
      await Promise.all(updates);
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
