import { API_ENDPOINTS, buildApiUrl, normalizeBaseUrl } from "../../config/constants";
import { isSecureEndpoint } from "../../utils/urlUtils";
import logger from "../../utils/logger";

export type OpenAiEndpointPreference = "responses" | "chat";
export type OpenAiEndpointCandidate = { url: string; type: OpenAiEndpointPreference };

const DEFAULT_STORAGE_KEY = "openAiEndpointPreference";

export class OpenAiEndpointResolver {
  private preferenceCache = new Map<string, OpenAiEndpointPreference>();
  private storageKey: string;

  constructor(storageKey = DEFAULT_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  getConfiguredBase(localStorage?: Storage): string {
    if (!localStorage) {
      return API_ENDPOINTS.OPENAI_BASE;
    }

    try {
      const provider = localStorage.getItem("reasoningProvider") || "";
      const isCustomProvider = provider === "custom";

      if (!isCustomProvider) {
        logger.logReasoning("CUSTOM_REASONING_ENDPOINT_CHECK", {
          hasCustomUrl: false,
          provider,
          reason: "Provider is not 'custom', using default OpenAI endpoint",
          defaultEndpoint: API_ENDPOINTS.OPENAI_BASE,
        });
        return API_ENDPOINTS.OPENAI_BASE;
      }

      const stored = localStorage.getItem("cloudReasoningBaseUrl") || "";
      const trimmed = stored.trim();

      if (!trimmed) {
        logger.logReasoning("CUSTOM_REASONING_ENDPOINT_CHECK", {
          hasCustomUrl: false,
          provider,
          usingDefault: true,
          defaultEndpoint: API_ENDPOINTS.OPENAI_BASE,
        });
        return API_ENDPOINTS.OPENAI_BASE;
      }

      const normalized = normalizeBaseUrl(trimmed) || API_ENDPOINTS.OPENAI_BASE;

      logger.logReasoning("CUSTOM_REASONING_ENDPOINT_CHECK", {
        hasCustomUrl: true,
        provider,
        rawUrl: trimmed,
        normalizedUrl: normalized,
        defaultEndpoint: API_ENDPOINTS.OPENAI_BASE,
      });

      const knownNonOpenAIUrls = [
        "api.groq.com",
        "api.anthropic.com",
        "generativelanguage.googleapis.com",
      ];

      const isKnownNonOpenAI = knownNonOpenAIUrls.some((url) => normalized.includes(url));
      if (isKnownNonOpenAI) {
        logger.logReasoning("OPENAI_BASE_REJECTED", {
          reason: "Custom URL is a known non-OpenAI provider, using default OpenAI endpoint",
          attempted: normalized,
        });
        return API_ENDPOINTS.OPENAI_BASE;
      }

      if (!isSecureEndpoint(normalized)) {
        logger.logReasoning("OPENAI_BASE_REJECTED", {
          reason: "HTTPS required (HTTP allowed for local network only)",
          attempted: normalized,
        });
        return API_ENDPOINTS.OPENAI_BASE;
      }

      logger.logReasoning("CUSTOM_REASONING_ENDPOINT_RESOLVED", {
        customEndpoint: normalized,
        isCustom: true,
        provider,
      });

      return normalized;
    } catch (error) {
      logger.logReasoning("CUSTOM_REASONING_ENDPOINT_ERROR", {
        error: (error as Error).message,
        fallbackTo: API_ENDPOINTS.OPENAI_BASE,
      });
      return API_ENDPOINTS.OPENAI_BASE;
    }
  }

  getEndpointCandidates(base: string, localStorage?: Storage): OpenAiEndpointCandidate[] {
    const lower = base.toLowerCase();

    if (lower.endsWith("/responses") || lower.endsWith("/chat/completions")) {
      const type: OpenAiEndpointPreference = lower.endsWith("/responses") ? "responses" : "chat";
      return [{ url: base, type }];
    }

    const preference = this.getStoredPreference(base, localStorage);
    if (preference === "chat") {
      return [{ url: buildApiUrl(base, "/chat/completions"), type: "chat" }];
    }

    return [
      { url: buildApiUrl(base, "/responses"), type: "responses" },
      { url: buildApiUrl(base, "/chat/completions"), type: "chat" },
    ];
  }

  getStoredPreference(base: string, localStorage?: Storage): OpenAiEndpointPreference | undefined {
    if (this.preferenceCache.has(base)) {
      return this.preferenceCache.get(base);
    }

    if (!localStorage) {
      return undefined;
    }

    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        return undefined;
      }
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        return undefined;
      }
      const value = (parsed as any)[base];
      if (value === "responses" || value === "chat") {
        this.preferenceCache.set(base, value);
        return value;
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  rememberPreference(base: string, preference: OpenAiEndpointPreference, localStorage?: Storage): void {
    this.preferenceCache.set(base, preference);

    if (!localStorage) {
      return;
    }

    try {
      const raw = localStorage.getItem(this.storageKey);
      const parsed = raw ? JSON.parse(raw) : {};
      const data = typeof parsed === "object" && parsed !== null ? parsed : {};
      (data as any)[base] = preference;
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {}
  }
}

