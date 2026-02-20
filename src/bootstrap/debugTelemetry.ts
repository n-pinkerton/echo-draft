import logger from "../utils/logger";

export const DEBUG_MODE_STORAGE_KEY = "openwhisprDebugEnabled";

export const shouldRedactLocalStorageKey = (key = ""): boolean => {
  const normalized = String(key || "").toLowerCase();
  // Allow list for non-secret "key" settings (hotkeys).
  if (normalized === "dictationkey" || normalized === "dictationkeyclipboard") {
    return false;
  }
  // Redact anything that looks like a secret/token.
  return (
    normalized.includes("api_key") ||
    normalized.includes("apikey") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("authorization")
  );
};

export const sanitizeLocalStorageValue = (key: string, value: string | null): string | null => {
  if (value == null) return null;
  if (shouldRedactLocalStorageKey(key)) {
    return "[REDACTED]";
  }
  return String(value);
};

const getLocalStorageSnapshot = (): Record<string, string | null> => {
  const snapshot: Record<string, string | null> = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      snapshot[key] = sanitizeLocalStorageValue(key, localStorage.getItem(key));
    }
  } catch (e) {
    snapshot.__error = (e as Error)?.message || String(e);
  }
  return snapshot;
};

export async function bootstrapDebugTelemetry(): Promise<void> {
  try {
    if (typeof window === "undefined" || !window.electronAPI?.getDebugState) {
      return;
    }

    const win = window as unknown as { __openwhisprDebugTelemetryBootstrapped?: boolean };
    if (win.__openwhisprDebugTelemetryBootstrapped) {
      return;
    }
    win.__openwhisprDebugTelemetryBootstrapped = true;

    let state = await window.electronAPI.getDebugState().catch(() => null);
    const storedDebugMode = localStorage.getItem(DEBUG_MODE_STORAGE_KEY);
    if (storedDebugMode === "true" || storedDebugMode === "false") {
      const desiredDebugMode = storedDebugMode === "true";
      const currentDebugMode = Boolean(state?.enabled);
      if (desiredDebugMode !== currentDebugMode) {
        const reconciledState = await window.electronAPI
          .setDebugLogging(desiredDebugMode)
          .catch(() => null);
        if (reconciledState?.success) {
          state = reconciledState;
        } else {
          logger.warn(
            "Failed to reconcile debug mode from localStorage",
            {
              desiredDebugMode,
              currentDebugMode,
              error: reconciledState?.error || "setDebugLogging failed",
            },
            "telemetry"
          );
          localStorage.setItem(DEBUG_MODE_STORAGE_KEY, String(currentDebugMode));
        }
      }
    }

    if (!state?.enabled) {
      localStorage.setItem(DEBUG_MODE_STORAGE_KEY, String(false));
      return;
    }

    logger.refreshLogLevel();
    localStorage.setItem(DEBUG_MODE_STORAGE_KEY, String(true));

    const isControlPanel =
      window.location.pathname.includes("control") || window.location.search.includes("panel=true");

    logger.info(
      "Debug telemetry bootstrapped",
      {
        windowType: isControlPanel ? "control-panel" : "dictation-panel",
        href: window.location.href,
        logPath: state.logPath,
        logsDir: state.logsDir || null,
        logLevel: state.logLevel || null,
      },
      "telemetry"
    );

    logger.info(
      "Renderer settings snapshot",
      {
        windowType: isControlPanel ? "control-panel" : "dictation-panel",
        localStorage: getLocalStorageSnapshot(),
      },
      "settings"
    );

    // Log all localStorage changes while debug telemetry is on (settings + internal flags).
    // This intentionally includes values unless they look like secrets/tokens.
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);
    const originalClear = localStorage.clear.bind(localStorage);

    localStorage.setItem = (key: string, value: string) => {
      const before = localStorage.getItem(key);
      originalSetItem(key, value);
      const after = localStorage.getItem(key);
      logger.trace(
        "localStorage.setItem",
        {
          key,
          before: sanitizeLocalStorageValue(key, before),
          after: sanitizeLocalStorageValue(key, after),
        },
        "settings"
      );
    };

    localStorage.removeItem = (key: string) => {
      const before = localStorage.getItem(key);
      originalRemoveItem(key);
      logger.trace(
        "localStorage.removeItem",
        { key, before: sanitizeLocalStorageValue(key, before) },
        "settings"
      );
    };

    localStorage.clear = () => {
      originalClear();
      logger.trace("localStorage.clear", {}, "settings");
    };
  } catch (e) {
    // Never block app startup for telemetry.
    try {
      logger.warn("Debug telemetry bootstrap failed", { error: (e as Error)?.message }, "telemetry");
    } catch {
      // Ignore
    }
  }
}

