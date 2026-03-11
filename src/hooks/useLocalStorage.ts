import { useState, useCallback } from "react";

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
      const keysToCheck = [key, ...legacyKeys.filter((legacyKey) => legacyKey && legacyKey !== key)];

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

  const setValue = useCallback(
    (value: T | ((prevState: T) => T)) => {
      setState((currentState) => {
        try {
          const valueToStore = value instanceof Function ? value(currentState) : value;
          localStorage.setItem(key, serialize(valueToStore));
          return valueToStore;
        } catch (error) {
          console.error(`Error setting localStorage key "${key}":`, error);
          return currentState;
        }
      });
    },
    [key, serialize]
  );

  const remove = useCallback(() => {
    try {
      localStorage.removeItem(key);
      setState(defaultValue);
    } catch (error) {
      console.error(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, defaultValue]);

  return [state, setValue, remove] as const;
}
