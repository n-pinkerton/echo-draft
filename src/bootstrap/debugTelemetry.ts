import logger from "../utils/logger";
import { DEBUG_MODE_STORAGE_KEY, LEGACY_DEBUG_MODE_STORAGE_KEY } from "../utils/branding";

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
    normalized.includes("authorization") ||
    normalized.includes("dictionary") ||
    normalized.includes("prompt") ||
    normalized.includes("transcript") ||
    normalized.includes("deviceid") ||
    normalized.includes("email") ||
    normalized === "agentname"
  );
};

export const sanitizeLocalStorageValue = (key: string, value: string | null): string | null => {
  if (value == null) return null;
  if (shouldRedactLocalStorageKey(key)) {
    return "[REDACTED]";
  }
  return String(value);
};

export const sanitizeTelemetryUrl = (value: string): string => {
  const raw = String(value || "");
  try {
    const parsed = new URL(raw);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return raw.split(/[?#]/, 1)[0];
  }
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

    const win = window as unknown as { __echoDraftDebugTelemetryBootstrapped?: boolean };
    if (win.__echoDraftDebugTelemetryBootstrapped) {
      return;
    }
    win.__echoDraftDebugTelemetryBootstrapped = true;

    const state = await window.electronAPI.getDebugState().catch(() => null);
    // Main-process persisted state is authoritative. A renderer-local value must never
    // silently enable sensitive capture at startup.
    localStorage.removeItem(LEGACY_DEBUG_MODE_STORAGE_KEY);

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
        href: sanitizeTelemetryUrl(window.location.href),
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

    // Log settings changes while keeping secrets and content-bearing values redacted.
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
      logger.warn(
        "Debug telemetry bootstrap failed",
        { error: (e as Error)?.message },
        "telemetry"
      );
    } catch {
      // Ignore
    }
  }
}
