import { useCallback, useEffect, useRef } from "react";

import { useLocalStorage } from "../useLocalStorage";

export function useHotkeySettings() {
  const [dictationKey, setDictationKeyLocal] = useLocalStorage("dictationKey", "", {
    serialize: String,
    deserialize: String,
  });

  const setDictationKey = useCallback(
    (key: string) => {
      setDictationKeyLocal(key);
      if (typeof window !== "undefined" && window.electronAPI?.notifyHotkeyChanged) {
        window.electronAPI.notifyHotkeyChanged(key);
      }
      if (typeof window !== "undefined" && window.electronAPI?.saveDictationKey) {
        window.electronAPI.saveDictationKey(key);
      }
    },
    [setDictationKeyLocal]
  );

  const [dictationKeyClipboard, setDictationKeyClipboardLocal] = useLocalStorage(
    "dictationKeyClipboard",
    "",
    {
      serialize: String,
      deserialize: String,
    }
  );

  const setDictationKeyClipboard = useCallback(
    (key: string) => {
      setDictationKeyClipboardLocal(key);
      if (typeof window !== "undefined" && window.electronAPI?.notifyClipboardHotkeyChanged) {
        window.electronAPI.notifyClipboardHotkeyChanged(key);
      }
      if (typeof window !== "undefined" && window.electronAPI?.saveDictationKeyClipboard) {
        window.electronAPI.saveDictationKeyClipboard(key);
      }
    },
    [setDictationKeyClipboardLocal]
  );

  const [activationMode, setActivationModeLocal] = useLocalStorage<"tap" | "push">(
    "activationMode",
    "tap",
    {
      serialize: String,
      deserialize: (value) => (value === "push" ? "push" : "tap"),
    }
  );

  const setActivationMode = useCallback(
    (mode: "tap" | "push") => {
      setActivationModeLocal(mode);
      if (typeof window !== "undefined" && window.electronAPI?.notifyActivationModeChanged) {
        window.electronAPI.notifyActivationModeChanged(mode);
      }
    },
    [setActivationModeLocal]
  );

  const hasRunActivationModeSync = useRef(false);
  useEffect(() => {
    if (hasRunActivationModeSync.current) return;
    hasRunActivationModeSync.current = true;

    const sync = async () => {
      if (!window.electronAPI?.getActivationMode) return;
      const envMode = await window.electronAPI.getActivationMode();
      if (envMode && envMode !== activationMode) {
        setActivationModeLocal(envMode);
      }
    };
    sync().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasRunDictationKeySync = useRef(false);
  useEffect(() => {
    if (hasRunDictationKeySync.current) return;
    hasRunDictationKeySync.current = true;

    const sync = async () => {
      if (window.electronAPI?.getDictationKey) {
        const envHotkey = await window.electronAPI.getDictationKey();
        if (envHotkey && envHotkey !== dictationKey) {
          setDictationKeyLocal(envHotkey);
        }
      }

      if (window.electronAPI?.getDictationKeyClipboard) {
        const envClipboardHotkey = await window.electronAPI.getDictationKeyClipboard();
        if (envClipboardHotkey && envClipboardHotkey !== dictationKeyClipboard) {
          setDictationKeyClipboardLocal(envClipboardHotkey);
        }
      }
    };
    sync().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    dictationKey,
    dictationKeyClipboard,
    activationMode,
    setDictationKey,
    setDictationKeyClipboard,
    setActivationMode,
  };
}

