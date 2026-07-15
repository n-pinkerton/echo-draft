import { getBaseLanguageCode } from "../../../utils/languageSupport";
import {
  ECHO_DRAFT_BYOK_REASONED_SOURCE,
  ECHO_DRAFT_CLOUD_MODE,
  ECHO_DRAFT_CLOUD_SOURCE,
  ECHO_DRAFT_REASONED_SOURCE,
  normalizeCloudMode,
} from "../../../utils/branding";
import { invokeCancelableIpc } from "../../../utils/cancelableIpc";
import {
  createTranscriptionCancelledError,
  isTranscriptionCancelled,
  throwIfTranscriptionCancelled,
} from "../pipeline/cancellation";

/**
 * EchoDraft cloud transcription client used by AudioManager.
 *
 * Responsibilities:
 * - IPC call to `cloudTranscribe`
 * - optional reasoning/cleanup (cloud or BYOK reasoning)
 */
export class CloudTranscriber {
  /**
   * @param {{
   *   logger: any,
   *   emitProgress?: (payload: any) => void,
   *   withSessionRefresh: (fn: () => Promise<any>) => Promise<any>,
   *   getCleanupEnabledOverride?: () => boolean | null,
   *   reasoningCleanupService?: {
   *     processTranscriptionWithOutcome?: Function,
   *     processWithReasoningModel?: Function,
   *     processWithReasoningModelResult?: Function,
   *     validateCleanupCandidate?: Function,
   *   },
   * }} deps
   */
  constructor(deps = {}) {
    if (!deps.withSessionRefresh) {
      throw new Error("withSessionRefresh is required");
    }
    this.logger = deps.logger;
    this.emitProgress = deps.emitProgress;
    this.withSessionRefresh = deps.withSessionRefresh;
    this.getCleanupEnabledOverride = deps.getCleanupEnabledOverride;
    this.reasoningCleanupService = deps.reasoningCleanupService;
  }

  async processWithEchoDraftCloud(audioBlob, metadata = {}, runtime = {}) {
    const signal = runtime?.signal || null;
    throwIfTranscriptionCancelled(signal);
    if (!navigator.onLine) {
      const err = new Error("You're offline. Cloud transcription requires an internet connection.");
      err.code = "OFFLINE";
      throw err;
    }

    const timings = {};
    const language = getBaseLanguageCode(localStorage.getItem("preferredLanguage"));

    const arrayBuffer = await audioBlob.arrayBuffer();
    throwIfTranscriptionCancelled(signal);
    const opts = {};
    if (language) opts.language = language;

    const transcriptionStart = performance.now();
    const result = await this.withSessionRefresh(
      async () => {
        const res = await invokeCancelableIpc(signal, (requestId) =>
          window.electronAPI.cloudTranscribe(arrayBuffer, opts, requestId)
        );
        if (!res.success) {
          const err = new Error(res.error || "Cloud transcription failed");
          err.code = res.code;
          throw err;
        }
        return res;
      },
      { signal }
    );
    throwIfTranscriptionCancelled(signal);
    timings.transcriptionProcessingDurationMs = Math.round(performance.now() - transcriptionStart);

    const rawText = result.text;
    let processedText = rawText;

    const override = this.getCleanupEnabledOverride?.() ?? null;
    const useReasoningModel =
      override !== null ? override : localStorage.getItem("useReasoningModel") === "true";
    let source = ECHO_DRAFT_CLOUD_SOURCE;
    let cleanup = null;

    if (useReasoningModel && processedText) {
      this.emitProgress?.({
        stage: "cleaning",
        stageLabel: "Cleaning up",
        provider: ECHO_DRAFT_CLOUD_SOURCE,
      });
      const reasoningStart = performance.now();
      const cloudReasoningMode = normalizeCloudMode(
        localStorage.getItem("cloudReasoningMode") || ECHO_DRAFT_CLOUD_MODE
      );
      let attemptedManagedCleanupModel = null;

      try {
        if (cloudReasoningMode === ECHO_DRAFT_CLOUD_MODE) {
          const reasonResult = await this.withSessionRefresh(
            async () => {
              const res = await invokeCancelableIpc(signal, (requestId) =>
                window.electronAPI.cloudReason(
                  processedText,
                  {
                    language: localStorage.getItem("preferredLanguage") || "auto",
                  },
                  requestId
                )
              );
              if (!res.success) {
                const err = new Error(res.error || "Cloud reasoning failed");
                err.code = res.code;
                throw err;
              }
              return res;
            },
            { signal }
          );

          if (!reasonResult.success) {
            throw new Error("Cloud reasoning did not complete successfully.");
          }
          if (!reasonResult.text || !reasonResult.text.trim()) {
            throw new Error("Cloud reasoning returned an empty cleanup response.");
          }
          attemptedManagedCleanupModel = reasonResult.model || null;

          if (typeof this.reasoningCleanupService?.validateCleanupCandidate !== "function") {
            throw new Error("Cleanup preservation validation is unavailable.");
          }

          const validated = this.reasoningCleanupService.validateCleanupCandidate(
            rawText,
            reasonResult.text
          );
          processedText = validated.text;
          cleanup = {
            requested: true,
            attempted: true,
            applied: true,
            status: processedText === rawText ? "unchanged" : "applied",
            fallbackReason: null,
            model: attemptedManagedCleanupModel,
            appliedModel: attemptedManagedCleanupModel,
            modelSource: "managed",
            provider: ECHO_DRAFT_CLOUD_SOURCE,
            retryCount: 0,
            metrics: validated.assessment.metrics,
          };
          source = ECHO_DRAFT_REASONED_SOURCE;
        } else {
          const reasoningModel = localStorage.getItem("reasoningModel") || "";
          if (typeof this.reasoningCleanupService?.processTranscriptionWithOutcome === "function") {
            const result = await this.reasoningCleanupService.processTranscriptionWithOutcome(
              rawText,
              ECHO_DRAFT_CLOUD_SOURCE,
              override,
              runtime
            );
            processedText = result.text || rawText;
            cleanup = result.cleanup;
          } else if (reasoningModel) {
            const result =
              typeof this.reasoningCleanupService?.processWithReasoningModelResult === "function"
                ? await this.reasoningCleanupService.processWithReasoningModelResult(
                    rawText,
                    reasoningModel,
                    null,
                    runtime
                  )
                : {
                    text: await this.reasoningCleanupService.processWithReasoningModel(
                      rawText,
                      reasoningModel,
                      null,
                      runtime
                    ),
                    retryCount: 0,
                    assessment: { metrics: {} },
                  };
            if (!result.text) {
              throw new Error("BYOK reasoning returned an empty cleanup response.");
            }
            processedText = result.text;
            const retryDriftRecovered = result.retryDriftRecovered === true;
            const unchanged = processedText === rawText;
            const preferredSpellingApplied =
              typeof result.assessment?.metrics?.preferredSpellingCorrectionCount === "number" &&
              result.assessment.metrics.preferredSpellingCorrectionCount > 0 &&
              !unchanged;
            cleanup = {
              requested: true,
              attempted: true,
              applied: retryDriftRecovered ? !unchanged : true,
              status: unchanged ? "unchanged" : "applied",
              fallbackReason: null,
              model: reasoningModel,
              appliedModel: retryDriftRecovered ? null : result.appliedModel || reasoningModel,
              modelSource: "selected",
              provider: localStorage.getItem("reasoningProvider") || "auto",
              retryCount: result.retryCount,
              retryDriftRecovered,
              preferredSpellingApplied,
              metrics: result.assessment?.metrics || {},
            };
          } else {
            cleanup = {
              requested: true,
              attempted: false,
              applied: false,
              status: "fallback",
              fallbackReason: "not_configured",
              model: null,
              provider: localStorage.getItem("reasoningProvider") || "auto",
              retryCount: 0,
            };
          }
          if (cleanup?.applied && cleanup?.retryDriftRecovered !== true) {
            source = ECHO_DRAFT_BYOK_REASONED_SOURCE;
          }
        }
      } catch (reasonError) {
        if (isTranscriptionCancelled(reasonError, signal)) {
          throw createTranscriptionCancelledError();
        }
        processedText = rawText;
        const managedCleanup = cloudReasoningMode === ECHO_DRAFT_CLOUD_MODE;
        cleanup = {
          requested: true,
          attempted: true,
          applied: false,
          status: "fallback",
          fallbackReason:
            reasonError?.code === "CLEANUP_FIDELITY_REJECTED"
              ? "fidelity_rejected"
              : "provider_error",
          model: managedCleanup
            ? attemptedManagedCleanupModel
            : localStorage.getItem("reasoningModel") || null,
          appliedModel: null,
          modelSource: managedCleanup ? "managed" : "selected",
          provider: managedCleanup
            ? ECHO_DRAFT_CLOUD_SOURCE
            : localStorage.getItem("reasoningProvider") || "auto",
          retryCount: managedCleanup
            ? 0
            : Number(reasonError?.cleanupRetryCount) ||
              (reasonError?.code === "CLEANUP_FIDELITY_REJECTED" ? 1 : 0),
          ...(reasonError?.assessment?.metrics ? { metrics: reasonError.assessment.metrics } : {}),
        };
        this.logger?.error?.(
          "Cloud reasoning failed, using raw text",
          { error: reasonError?.message || String(reasonError), cloudReasoningMode },
          "reasoning"
        );
      } finally {
        timings.reasoningProcessingDurationMs = Math.round(performance.now() - reasoningStart);
      }
    }

    return {
      success: true,
      text: processedText,
      rawText,
      source,
      timings,
      limitReached: result.limitReached,
      wordsUsed: result.wordsUsed,
      wordsRemaining: result.wordsRemaining,
      ...(cleanup ? { cleanup } : {}),
    };
  }
}
