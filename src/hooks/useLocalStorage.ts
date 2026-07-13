import { useState, useCallback, useEffect, useRef } from "react";

const LOCAL_STORAGE_CHANGE_EVENT = "echodraft:local-storage-change";

type LocalStorageChangeDetail = {
  key: string;
};

function notifyLocalStorageChange(key: string) {
  queueMicrotask(() => {
    window.dispatchEvent(
      new CustomEvent<LocalStorageChangeDetail>(LOCAL_STORAGE_CHANGE_EVENT, {
        detail: { key },
      })
    );
  });
}

export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  options?: {
    serialize?: (value: T) => string;
    deserialize?: (value: string) => T;
    legacyKeys?: string[];
  }
) {
  const serialize = options?.serialize || JSON.stringify;
  const deserialize = options?.deserialize || JSON.parse;
  const legacyKeys = options?.legacyKeys || [];

  const [state, setState] = useState<T>(() => {
    try {
      const keysToCheck = [
        key,
        ...legacyKeys.filter((legacyKey) => legacyKey && legacyKey !== key),
      ];

      for (const candidateKey of keysToCheck) {
        const item = localStorage.getItem(candidateKey);
        if (item === null) {
          continue;
        }

        const parsed = deserialize(item);
        const normalizedValue = serialize(parsed);
        if (candidateKey !== key || item !== normalizedValue) {
          localStorage.setItem(key, normalizedValue);
        }
        for (const legacyKey of legacyKeys) {
          if (legacyKey !== key) {
            localStorage.removeItem(legacyKey);
          }
        }
        return parsed;
      }

      // Persist the default so direct localStorage.getItem() reads
      // (e.g. in audioManager, PromptStudio) see the intended value.
      localStorage.setItem(key, serialize(defaultValue));
      return defaultValue;
    } catch {
      return defaultValue;
    }
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const handleLocalStorageChange = (event: Event) => {
      const { key: changedKey } = (event as CustomEvent<LocalStorageChangeDetail>).detail;
      if (changedKey !== key) return;

      try {
        const value = localStorage.getItem(key);
        const nextValue = value === null ? defaultValue : deserialize(value);
        stateRef.current = nextValue;
        setState(nextValue);
      } catch {
        stateRef.current = defaultValue;
        setState(defaultValue);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== key) return;
      try {
        const nextValue = event.newValue === null ? defaultValue : deserialize(event.newValue);
        stateRef.current = nextValue;
        setState(nextValue);
      } catch {
        stateRef.current = defaultValue;
        setState(defaultValue);
      }
    };

    window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalStorageChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalStorageChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [defaultValue, deserialize, key]);

  const setValue = useCallback(
    (value: T | ((prevState: T) => T)) => {
      try {
        const valueToStore = value instanceof Function ? value(stateRef.current) : value;
        const serializedValue = serialize(valueToStore);
        localStorage.setItem(key, serializedValue);
        stateRef.current = valueToStore;
        setState(valueToStore);
        notifyLocalStorageChange(key);
      } catch (error) {
        console.error(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, serialize]
  );

  const remove = useCallback(() => {
    try {
      localStorage.removeItem(key);
      stateRef.current = defaultValue;
      setState(defaultValue);
      notifyLocalStorageChange(key);
    } catch (error) {
      console.error(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, defaultValue]);

  return [state, setValue, remove] as const;
}
