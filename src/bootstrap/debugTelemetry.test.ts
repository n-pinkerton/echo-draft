import { describe, expect, it } from "vitest";
import {
  sanitizeLocalStorageValue,
  sanitizeTelemetryUrl,
  shouldRedactLocalStorageKey,
} from "./debugTelemetry";

describe("debugTelemetry", () => {
  describe("shouldRedactLocalStorageKey", () => {
    it("does not redact hotkey storage keys", () => {
      expect(shouldRedactLocalStorageKey("dictationKey")).toBe(false);
      expect(shouldRedactLocalStorageKey("dictationKeyClipboard")).toBe(false);
    });

    it("redacts keys that look like secrets", () => {
      expect(shouldRedactLocalStorageKey("openaiApiKey")).toBe(true);
      expect(shouldRedactLocalStorageKey("AUTHORIZATION")).toBe(true);
      expect(shouldRedactLocalStorageKey("some_token")).toBe(true);
      expect(shouldRedactLocalStorageKey("password")).toBe(true);
    });
  });

  describe("sanitizeLocalStorageValue", () => {
    it("redacts values for secret-like keys", () => {
      expect(sanitizeLocalStorageValue("openaiApiKey", "sk-test")).toBe("[REDACTED]");
      expect(sanitizeLocalStorageValue("customDictionary", '["Private name"]')).toBe("[REDACTED]");
      expect(sanitizeLocalStorageValue("customUnifiedPrompt", "private cleanup note")).toBe(
        "[REDACTED]"
      );
      expect(sanitizeLocalStorageValue("selectedMicDeviceId", "device-123")).toBe("[REDACTED]");
    });

    it("preserves values for non-secret keys", () => {
      expect(sanitizeLocalStorageValue("theme", "dark")).toBe("dark");
    });
  });

  describe("sanitizeTelemetryUrl", () => {
    it.each([
      "neon_auth_session_verifier=verifier-secret",
      "token=token-secret",
      "code=oauth-code-secret",
      "email=private%40example.test",
    ])("removes query and fragment data containing %s", (sensitiveQuery) => {
      const sanitized = sanitizeTelemetryUrl(
        `https://app.example.test/control?panel=true&${sensitiveQuery}#access_token=fragment-secret`
      );

      expect(sanitized).toBe("https://app.example.test/control");
      expect(sanitized).not.toContain("secret");
      expect(sanitized).not.toContain("private");
    });
  });
});
