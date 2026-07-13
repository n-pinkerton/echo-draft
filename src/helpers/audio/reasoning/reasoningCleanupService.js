import { normalizeCleanupModelId, sanitizeProcessedText } from "../../../config/prompts";
import { assessCleanupFidelity, CleanupFidelityError } from "./cleanupFidelity";
import { repairRequestReasonFragment } from "./cleanupOutputRepairs";
import {
  createTranscriptionCancelledError,
  isTranscriptionCancelled,
  throwIfTranscriptionCancelled,
} from "../pipeline/cancellation";

const OPENAI_FIDELITY_RETRY_MODEL = "gpt-5.6-sol";
// A strict rescue may overcome a conservative rewrite-risk score, but never a
// detected change to ordering, causality, or other relation markers.
const SOL_RESCUE_ADVISORY_REASONS = new Set(["high-rewrite-risk"]);

const canAcceptStrictSolRescue = (assessment) => {
  if (
    !assessment ||
    !Array.isArray(assessment.reasons) ||
    assessment.reasons.length === 0 ||
    !assessment.reasons.every((reason) => SOL_RESCUE_ADVISORY_REASONS.has(reason))
  ) {
    return false;
  }

  const metrics = assessment.metrics || {};
  return (
    metrics.contentCoverage >= 0.9 &&
    metrics.contentPrecision >= 0.9 &&
    metrics.orderedBigramRetention >= 0.75 &&
    metrics.semanticMissingContentWordCount <= 5 &&
    metrics.semanticAddedContentWordCount <= 5
  );
};

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

  _getPreferenceKey(cleanupEnabledOverride, provider = "auto") {
    const storedValue = this._getStoredEnabledValue();
    const enabledKey =
      cleanupEnabledOverride === null
        ? `storage:${storedValue}`
        : `override:${cleanupEnabledOverride}`;
    return `${enabledKey}:provider:${provider || "auto"}`;
  }

  _isReasoningEnabled(cleanupEnabledOverride) {
    const storedValue = this._getStoredEnabledValue();
    return cleanupEnabledOverride !== null
      ? cleanupEnabledOverride
      : storedValue === "true" || (!!storedValue && storedValue !== "false");
  }

  _getReasoningEffort() {
    const storedValue =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("cleanupReasoningEffort") || ""
        : "";
    return storedValue === "none" || storedValue === "medium" ? storedValue : "low";
  }

  _getFidelityRetryModel(model) {
    const provider =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("reasoningProvider") || "auto"
        : "auto";
    return (provider === "openai" || provider === "auto") &&
      /^(?:gpt-5\.6-luna|gpt-5\.6-terra)$/.test(model)
      ? OPENAI_FIDELITY_RETRY_MODEL
      : model;
  }

  /**
   * Returns whether reasoning cleanup should run AND the service is reachable.
   *
   * @param {boolean|null} cleanupEnabledOverride
   * @returns {Promise<boolean>}
   */
  async isReasoningAvailable(cleanupEnabledOverride, provider = "auto") {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }

    const preferenceKey = this._getPreferenceKey(cleanupEnabledOverride, provider);
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
      const isAvailable = await this.reasoningService.isAvailable(provider);

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
   * @param {{signal?: AbortSignal}} runtime
   * @returns {Promise<{text: string, assessment: any, retryCount: number, appliedModel: string}>}
   */
  async processWithReasoningModelResult(text, model, agentName, runtime = {}) {
    this.logger?.logReasoning?.("CALLING_REASONING_SERVICE", {
      model,
      agentName,
      textLength: text.length,
    });

    const startTime = Date.now();
    const reasoningEffort = this._getReasoningEffort();
    const signal = runtime?.signal || null;
    let retryAttempted = false;
    let attemptedRetryModel = null;
    try {
      throwIfTranscriptionCancelled(signal);
      const firstResult = repairRequestReasonFragment(
        text,
        sanitizeProcessedText(
          await this.reasoningService.processText(text, model, agentName, {
            cleanupPromptMode: "preservation-first",
            reasoningEffort,
            ...(signal ? { signal } : {}),
          })
        )
      );
      throwIfTranscriptionCancelled(signal);
      const firstAssessment = assessCleanupFidelity(text, firstResult);

      if (firstAssessment.accepted) {
        const processingTimeMs = Date.now() - startTime;
        this.logger?.logReasoning?.("REASONING_SERVICE_COMPLETE", {
          model,
          processingTimeMs,
          resultLength: firstResult.length,
          retryCount: 0,
          success: true,
        });
        return {
          text: firstResult,
          assessment: firstAssessment,
          retryCount: 0,
          appliedModel: model,
        };
      }

      this.logger?.logReasoning?.("REASONING_FIDELITY_RETRY", {
        model,
        reasons: firstAssessment.reasons,
        metrics: firstAssessment.metrics,
      });

      const retryModel = this._getFidelityRetryModel(model);
      retryAttempted = true;
      attemptedRetryModel = retryModel;
      throwIfTranscriptionCancelled(signal);
      const retryResult = repairRequestReasonFragment(
        text,
        sanitizeProcessedText(
          await this.reasoningService.processText(text, retryModel, agentName, {
            cleanupPromptMode: "strict-preservation",
            reasoningEffort,
            ...(signal ? { signal } : {}),
          })
        )
      );
      throwIfTranscriptionCancelled(signal);
      const retryAssessment = assessCleanupFidelity(text, retryResult);
      const solRescueAccepted =
        retryModel === OPENAI_FIDELITY_RETRY_MODEL && canAcceptStrictSolRescue(retryAssessment);
      const effectiveRetryAssessment = solRescueAccepted
        ? {
            ...retryAssessment,
            accepted: true,
            reasons: [],
            advisoryReasons: retryAssessment.reasons,
          }
        : retryAssessment;
      const processingTimeMs = Date.now() - startTime;

      if (!effectiveRetryAssessment.accepted) {
        this.logger?.logReasoning?.("REASONING_FIDELITY_REJECTED", {
          model,
          retryModel,
          processingTimeMs,
          reasons: retryAssessment.reasons,
          metrics: retryAssessment.metrics,
          retryCount: 1,
        });
        throw new CleanupFidelityError(retryAssessment);
      }

      if (solRescueAccepted) {
        this.logger?.logReasoning?.("REASONING_SOL_RESCUE_ACCEPTED", {
          model,
          retryModel,
          processingTimeMs,
          advisoryReasons: retryAssessment.reasons,
          metrics: retryAssessment.metrics,
        });
      }

      this.logger?.logReasoning?.("REASONING_SERVICE_COMPLETE", {
        model,
        retryModel,
        processingTimeMs,
        resultLength: retryResult.length,
        retryCount: 1,
        success: true,
      });

      return {
        text: retryResult,
        assessment: effectiveRetryAssessment,
        retryCount: 1,
        appliedModel: retryModel,
      };
    } catch (error) {
      if (isTranscriptionCancelled(error, signal)) {
        throw createTranscriptionCancelledError();
      }
      if (retryAttempted && error && typeof error === "object") {
        error.cleanupRetryCount = 1;
        error.cleanupRetryModel = attemptedRetryModel;
      }
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

  async processWithReasoningModel(text, model, agentName, runtime = {}) {
    const result = await this.processWithReasoningModelResult(text, model, agentName, runtime);
    return result.text;
  }

  validateCleanupCandidate(originalText, candidateText) {
    const text = sanitizeProcessedText(candidateText);
    const assessment = assessCleanupFidelity(originalText, text);
    if (!assessment.accepted) {
      throw new CleanupFidelityError(assessment);
    }
    return { text, assessment };
  }

  /**
   * @param {string} text
   * @param {string} source
   * @param {boolean|null} cleanupEnabledOverride
   * @param {{signal?: AbortSignal}} runtime
   * @returns {Promise<{text: string, cleanup: Record<string, any>}>}
   */
  async processTranscriptionWithOutcome(text, source, cleanupEnabledOverride, runtime = {}) {
    const normalizedText = typeof text === "string" ? text.trim() : "";
    const signal = runtime?.signal || null;
    throwIfTranscriptionCancelled(signal);

    this.logger?.logReasoning?.("TRANSCRIPTION_RECEIVED", {
      source,
      textLength: normalizedText.length,
      timestamp: new Date().toISOString(),
    });

    const storedReasoningModel =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("reasoningModel") || ""
        : "";
    const reasoningProvider =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("reasoningProvider") || "auto"
        : "auto";
    const reasoningModel = normalizeCleanupModelId(storedReasoningModel, reasoningProvider);
    const agentName =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("agentName") || null
        : null;
    const requested = this._isReasoningEnabled(cleanupEnabledOverride);
    const baseOutcome = {
      requested,
      attempted: false,
      applied: false,
      status: requested ? "fallback" : "disabled",
      fallbackReason: requested ? null : "disabled",
      model: reasoningModel || null,
      appliedModel: null,
      provider: reasoningProvider || "auto",
      retryCount: 0,
    };

    if (
      reasoningModel &&
      reasoningModel !== storedReasoningModel &&
      typeof window !== "undefined"
    ) {
      localStorage.setItem("reasoningModel", reasoningModel);
      this.logger?.logReasoning?.("REASONING_MODEL_MIGRATED", {
        from: storedReasoningModel,
        to: reasoningModel,
        provider: reasoningProvider,
      });
    }

    if (!reasoningModel) {
      this.logger?.logReasoning?.("REASONING_SKIPPED", { reason: "No reasoning model selected" });
      return {
        text: normalizedText,
        cleanup: {
          ...baseOutcome,
          status: requested ? "fallback" : "disabled",
          fallbackReason: requested ? "not_configured" : "disabled",
        },
      };
    }

    const useReasoning = await this.isReasoningAvailable(cleanupEnabledOverride, reasoningProvider);
    throwIfTranscriptionCancelled(signal);
    this.logger?.logReasoning?.("REASONING_CHECK", {
      useReasoning,
      reasoningModel,
      reasoningProvider,
      agentName,
    });

    if (!useReasoning || !normalizedText) {
      return {
        text: normalizedText,
        cleanup: {
          ...baseOutcome,
          status: !requested ? "disabled" : normalizedText ? "fallback" : "unchanged",
          fallbackReason: !requested ? "disabled" : normalizedText ? "unavailable" : null,
        },
      };
    }

    try {
      this.logger?.logReasoning?.("SENDING_TO_REASONING", {
        preparedTextLength: normalizedText.length,
        model: reasoningModel,
        provider: reasoningProvider,
      });

      const result = await this.processWithReasoningModelResult(
        normalizedText,
        reasoningModel,
        agentName,
        runtime
      );
      this.logger?.logReasoning?.("REASONING_SUCCESS", {
        resultLength: result.text.length,
        retryCount: result.retryCount,
        processingTime: new Date().toISOString(),
      });

      const unchanged = result.text === normalizedText;
      return {
        text: result.text,
        cleanup: {
          ...baseOutcome,
          attempted: true,
          applied: true,
          status: unchanged ? "unchanged" : "applied",
          fallbackReason: null,
          retryCount: result.retryCount,
          appliedModel: result.appliedModel || reasoningModel,
          metrics: result.assessment.metrics,
        },
      };
    } catch (error) {
      if (isTranscriptionCancelled(error, signal)) {
        throw createTranscriptionCancelledError();
      }
      this.logger?.logReasoning?.("REASONING_FAILED", {
        error: error?.message || String(error),
        stack: error?.stack,
        fallbackToCleanup: true,
      });

      return {
        text: sanitizeProcessedText(normalizedText),
        cleanup: {
          ...baseOutcome,
          attempted: true,
          applied: false,
          status: "fallback",
          fallbackReason:
            error?.code === "CLEANUP_FIDELITY_REJECTED" ? "fidelity_rejected" : "provider_error",
          retryCount:
            error?.cleanupRetryCount === 1 || error?.code === "CLEANUP_FIDELITY_REJECTED" ? 1 : 0,
          ...(error?.assessment?.metrics ? { metrics: error.assessment.metrics } : {}),
        },
      };
    }
  }

  async processTranscription(text, source, cleanupEnabledOverride, runtime = {}) {
    const result = await this.processTranscriptionWithOutcome(
      text,
      source,
      cleanupEnabledOverride,
      runtime
    );
    return result.text;
  }
}
