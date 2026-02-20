import { describe, expect, it } from "vitest";
import { sanitizeLocalStorageValue, shouldRedactLocalStorageKey } from "./debugTelemetry";

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
    });

    it("preserves values for non-secret keys", () => {
      expect(sanitizeLocalStorageValue("theme", "dark")).toBe("dark");
    });
  });
});

