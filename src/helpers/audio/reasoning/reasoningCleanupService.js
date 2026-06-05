import {
  DEFAULT_CLEANUP_MODEL_ID,
  SUPPORTED_CLEANUP_MODEL_IDS,
  sanitizeProcessedText,
} from "../../../config/prompts";

const RETIRED_OPENAI_CLEANUP_MODELS = new Set([
  "gpt-5.2",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
]);

function normalizeCleanupModel(model, provider) {
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  const normalizedProvider = typeof provider === "string" ? provider.trim() : "";

  if (
    RETIRED_OPENAI_CLEANUP_MODELS.has(normalizedModel) &&
    (normalizedProvider === "openai" || normalizedProvider === "auto" || !normalizedProvider)
  ) {
    return DEFAULT_CLEANUP_MODEL_ID;
  }

  if (
    normalizedModel.startsWith("gpt-") &&
    !SUPPORTED_CLEANUP_MODEL_IDS.includes(normalizedModel) &&
    (normalizedProvider === "openai" || normalizedProvider === "auto")
  ) {
    return DEFAULT_CLEANUP_MODEL_ID;
  }

  return normalizedModel;
}

/**
 * Shared cleanup/orchestration around `ReasoningService` for transcript post-processing.
 *
 * AudioManager uses this for both:
 * - non-streaming transcription (OpenAI/local Whisper)
 * - streaming transcription (AssemblyAI) BYOK reasoning mode
 *
 * This service owns the "reasoning availability" cache because it’s expensive to check
 * on every dictation.
 */

export class ReasoningCleanupService {
  /**
   * @param {{
   *   logger: { logReasoning?: Function },
   *   reasoningService: { processText: Function, isAvailable: Function },
   *   cacheTtlMs?: number
   * }} deps
   */
  constructor(deps = {}) {
    this.logger = deps.logger;
    this.reasoningService = deps.reasoningService;
    this.cacheTtlMs = typeof deps.cacheTtlMs === "number" ? deps.cacheTtlMs : 30_000;

    this.availabilityCache = { value: false, expiresAt: 0 };
    this.cachedPreferenceKey = null;
  }

  _getStoredEnabledValue() {
    if (typeof window === "undefined" || !window.localStorage) {
      return "";
    }
    return localStorage.getItem("useReasoningModel") || "";
  }

  _getPreferenceKey(cleanupEnabledOverride) {
    const storedValue = this._getStoredEnabledValue();
    return cleanupEnabledOverride === null ? `storage:${storedValue}` : `override:${cleanupEnabledOverride}`;
  }

  _isReasoningEnabled(cleanupEnabledOverride) {
    const storedValue = this._getStoredEnabledValue();
    return cleanupEnabledOverride !== null
      ? cleanupEnabledOverride
      : storedValue === "true" || (!!storedValue && storedValue !== "false");
  }

  /**
   * Returns whether reasoning cleanup should run AND the service is reachable.
   *
   * @param {boolean|null} cleanupEnabledOverride
   * @returns {Promise<boolean>}
   */
  async isReasoningAvailable(cleanupEnabledOverride) {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }

    const preferenceKey = this._getPreferenceKey(cleanupEnabledOverride);
    const now = Date.now();
    const cacheValid =
      now < this.availabilityCache.expiresAt && this.cachedPreferenceKey === preferenceKey;

    if (cacheValid) {
      return this.availabilityCache.value;
    }

    const useReasoning = this._isReasoningEnabled(cleanupEnabledOverride);
    this.logger?.logReasoning?.("REASONING_CHECK", {
      useReasoning,
      preferenceKey,
      cleanupEnabledOverride,
      storedValue: this._getStoredEnabledValue(),
    });

    if (!useReasoning) {
      this.availabilityCache = { value: false, expiresAt: now + this.cacheTtlMs };
      this.cachedPreferenceKey = preferenceKey;
      return false;
    }

    try {
      const isAvailable = await this.reasoningService.isAvailable();

      this.logger?.logReasoning?.("REASONING_AVAILABILITY", {
        isAvailable,
        reasoningEnabled: useReasoning,
        finalDecision: useReasoning && isAvailable,
      });

      this.availabilityCache = { value: isAvailable, expiresAt: now + this.cacheTtlMs };
      this.cachedPreferenceKey = preferenceKey;
      return isAvailable;
    } catch (error) {
      this.logger?.logReasoning?.("REASONING_AVAILABILITY_ERROR", {
        error: error?.message || String(error),
        stack: error?.stack,
      });

      this.availabilityCache = { value: false, expiresAt: now + this.cacheTtlMs };
      this.cachedPreferenceKey = preferenceKey;
      return false;
    }
  }

  /**
   * @param {string} text
   * @param {string} model
   * @param {string|null} agentName
   * @returns {Promise<string>}
   */
  async processWithReasoningModel(text, model, agentName) {
    this.logger?.logReasoning?.("CALLING_REASONING_SERVICE", {
      model,
      agentName,
      textLength: text.length,
    });

    const startTime = Date.now();
    try {
      const result = await this.reasoningService.processText(text, model, agentName);
      const processingTimeMs = Date.now() - startTime;

      this.logger?.logReasoning?.("REASONING_SERVICE_COMPLETE", {
        model,
        processingTimeMs,
        resultLength: result.length,
        success: true,
      });

      return sanitizeProcessedText(result);
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      this.logger?.logReasoning?.("REASONING_SERVICE_ERROR", {
        model,
        processingTimeMs,
        error: error?.message || String(error),
        stack: error?.stack,
      });
      throw error;
    }
  }

  /**
   * @param {string} text
   * @param {string} source
   * @param {boolean|null} cleanupEnabledOverride
   * @returns {Promise<string>}
   */
  async processTranscription(text, source, cleanupEnabledOverride) {
    const normalizedText = typeof text === "string" ? text.trim() : "";

    this.logger?.logReasoning?.("TRANSCRIPTION_RECEIVED", {
      source,
      textLength: normalizedText.length,
      textPreview: normalizedText.substring(0, 100) + (normalizedText.length > 100 ? "..." : ""),
      timestamp: new Date().toISOString(),
    });

    const storedReasoningModel =
      typeof window !== "undefined" && window.localStorage ? localStorage.getItem("reasoningModel") || "" : "";
    const reasoningProvider =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("reasoningProvider") || "auto"
        : "auto";
    const reasoningModel = normalizeCleanupModel(storedReasoningModel, reasoningProvider);
    const agentName =
      typeof window !== "undefined" && window.localStorage ? localStorage.getItem("agentName") || null : null;

    if (reasoningModel && reasoningModel !== storedReasoningModel && typeof window !== "undefined") {
      localStorage.setItem("reasoningModel", reasoningModel);
      this.logger?.logReasoning?.("REASONING_MODEL_MIGRATED", {
        from: storedReasoningModel,
        to: reasoningModel,
        provider: reasoningProvider,
      });
    }

    if (!reasoningModel) {
      this.logger?.logReasoning?.("REASONING_SKIPPED", { reason: "No reasoning model selected" });
      return normalizedText;
    }

    const useReasoning = await this.isReasoningAvailable(cleanupEnabledOverride);
    this.logger?.logReasoning?.("REASONING_CHECK", {
      useReasoning,
      reasoningModel,
      reasoningProvider,
      agentName,
    });

    if (!useReasoning || !normalizedText) {
      return normalizedText;
    }

    try {
      this.logger?.logReasoning?.("SENDING_TO_REASONING", {
        preparedTextLength: normalizedText.length,
        model: reasoningModel,
        provider: reasoningProvider,
      });

      const result = await this.processWithReasoningModel(normalizedText, reasoningModel, agentName);
      this.logger?.logReasoning?.("REASONING_SUCCESS", {
        resultLength: result.length,
        resultPreview: result.substring(0, 100) + (result.length > 100 ? "..." : ""),
        processingTime: new Date().toISOString(),
      });

      return result;
    } catch (error) {
      this.logger?.logReasoning?.("REASONING_FAILED", {
        error: error?.message || String(error),
        stack: error?.stack,
        fallbackToCleanup: true,
      });

      return sanitizeProcessedText(normalizedText);
    }
  }
}
