import logger from "../../../utils/logger";
import {
  ECHO_DRAFT_CLOUD_MODE,
  ECHO_DRAFT_CLOUD_SOURCE,
  isEchoDraftCloudMode,
} from "../../../utils/branding";
import { raceWithAbort } from "../../../utils/retry";
import { invokeCancelableIpc } from "../../../utils/cancelableIpc";
import {
  createTranscriptionCancelledError,
  isTranscriptionCancelled,
  throwIfTranscriptionCancelled,
} from "../pipeline/cancellation";
import { cleanupStreamingListeners } from "./assemblyAiStreamingCleanup";
import { cancelStreamingStartup } from "./assemblyAiStreamingStart";

const STREAMING_WORKLET_FLUSH_TIMEOUT_MS = 1000;
const STREAMING_POST_FLUSH_GRACE_MS = 150;

const getOrStartMainStreamingTeardown = (manager) => {
  if (manager.streamingMainStopPromise) {
    return manager.streamingMainStopPromise;
  }

  const stopPromise = Promise.resolve()
    .then(() => window.electronAPI.assemblyAiStreamingStop())
    .catch((error) => {
      logger.debug("Streaming disconnect error", { error: error.message }, "streaming");
      return { success: false, error: error.message };
    });
  manager.streamingMainStopPromise = stopPromise;
  return stopPromise;
};

const settleStreamingState = (manager) => {
  manager.isProcessing = false;
  manager.streamingContext = null;
  if (manager.processingQueue.length > 0) {
    manager.startQueuedProcessingIfPossible();
  } else {
    manager.emitStateChange({
      isRecording: manager.isRecording,
      isProcessing: false,
      isStreaming: manager.isStreaming,
    });
  }

  if (manager.shouldUseStreaming()) {
    manager.warmupStreamingConnection().catch((error) => {
      logger.debug("Background re-warm failed", { error: error.message }, "streaming");
    });
  }
};

export function stopStreamingRecording(manager) {
  if (manager.streamingStopPromise) {
    return manager.streamingStopPromise;
  }

  const startupCancelled = cancelStreamingStartup(manager);
  if (!manager.isStreaming) {
    return Promise.resolve(startupCancelled);
  }

  const controller = new AbortController();
  manager.activeProcessingAbortController = controller;
  let guardedPromise;
  guardedPromise = performStopStreamingRecording(manager, { signal: controller.signal })
    .catch(async (error) => {
      // Capture has already ended, but an exception may occur anywhere from the
      // worklet flush through delivery/history persistence. Always finish the
      // transport teardown before releasing FIFO processing ownership.
      manager.streamingAudioForwarding = false;
      manager.isStreaming = false;
      window.electronAPI.assemblyAiStreamingForceEndpoint?.();
      await getOrStartMainStreamingTeardown(manager);
      cleanupStreamingListeners(manager);

      if (isTranscriptionCancelled(error, controller.signal)) {
        logger.info("Streaming processing cancelled after transport teardown", {}, "streaming");
        return false;
      }
      throw error;
    })
    .finally(() => {
      // This is the single settlement point for success, cancellation,
      // incomplete termination, and unexpected delivery/finalization errors.
      try {
        settleStreamingState(manager);
      } finally {
        if (manager.activeProcessingAbortController === controller) {
          manager.activeProcessingAbortController = null;
        }
        if (manager.streamingStopPromise === guardedPromise) {
          manager.streamingStopPromise = null;
        }
        manager.streamingMainStopPromise = null;
      }
    });
  manager.streamingStopPromise = guardedPromise;
  return guardedPromise;
}

async function performStopStreamingRecording(manager, runtime = {}) {
  if (!manager.isStreaming) return false;
  const signal = runtime?.signal || null;
  throwIfTranscriptionCancelled(signal);

  const durationSeconds = manager.recordingStartTime
    ? (Date.now() - manager.recordingStartTime) / 1000
    : null;
  const recordDurationMs =
    typeof durationSeconds === "number" ? Math.max(0, Math.round(durationSeconds * 1000)) : null;

  const t0 = performance.now();
  let finalText = manager.streamingFinalText || "";

  // 1. Update UI immediately
  manager.isRecording = false;
  manager.isProcessing = true;
  // Capture ownership ends synchronously. Streaming transport finalization has
  // separate promise/controller ownership and must not make a newly started
  // non-streaming recording look like it is still the old stream.
  manager.isStreaming = false;
  manager.recordingStartTime = null;
  manager.emitStateChange({ isRecording: false, isProcessing: true, isStreaming: false });

  // 2. Stop the processor — it flushes its remaining buffer on "stop".
  //    We keep forwarding enabled until the worklet confirms the flush is posted.
  const flushWaiter = manager.streamingProcessor
    ? manager.streamingWorklet.createFlushWaiter()
    : null;
  if (manager.streamingProcessor) {
    try {
      manager.streamingProcessor.port.postMessage("stop");
      manager.streamingProcessor.disconnect();
    } catch {
      // Ignore
    }
    manager.streamingProcessor = null;
  }
  if (manager.streamingSource) {
    try {
      manager.streamingSource.disconnect();
    } catch {
      // Ignore
    }
    manager.streamingSource = null;
  }
  manager.streamingAudioContext = null;
  if (manager.streamingStream) {
    manager.streamingStream.getTracks().forEach((track) => track.stop());
    manager.streamingStream = null;
  }
  manager.emitProgress({
    stage: "transcribing",
    stageLabel: "Transcribing",
    message: "Finalizing stream",
    context: manager.streamingContext,
    recordingClosed: true,
  });
  const tAudioCleanup = performance.now();

  // 3. Wait for flushed buffer to travel: port → main thread → IPC → WebSocket → server.
  //    The worklet posts a FLUSH_DONE sentinel after posting the final buffer.
  if (flushWaiter) {
    await raceWithAbort(
      Promise.race([
        flushWaiter.promise,
        new Promise((resolve) => setTimeout(resolve, STREAMING_WORKLET_FLUSH_TIMEOUT_MS)),
      ]),
      signal
    );
    manager.streamingWorklet.resolveFlushWaiter();
  }
  await raceWithAbort(
    new Promise((resolve) => setTimeout(resolve, STREAMING_POST_FLUSH_GRACE_MS)),
    signal
  );
  manager.streamingAudioForwarding = false;

  // 4. ForceEndpoint finalizes any in-progress turn, then Terminate closes the session.
  //    The server MUST process ALL remaining audio and send ALL Turn messages before
  //    responding with Termination — so awaiting this guarantees we get every word.
  window.electronAPI.assemblyAiStreamingForceEndpoint?.();
  throwIfTranscriptionCancelled(signal);
  const tForceEndpoint = performance.now();

  const stopResult = await raceWithAbort(getOrStartMainStreamingTeardown(manager), signal);
  throwIfTranscriptionCancelled(signal);
  const tTerminate = performance.now();

  const terminationConfirmed =
    stopResult?.success === true && stopResult?.terminationConfirmed === true;
  if (!terminationConfirmed) {
    cleanupStreamingListeners(manager);
    const error = new Error(
      stopResult?.terminationTimedOut
        ? "The streaming service did not confirm the end of the transcription."
        : stopResult?.error || "The streaming service could not finalize the transcription."
    );
    error.code = "STREAMING_TRANSCRIPTION_INCOMPLETE";
    logger.warn(
      "Streaming transcription was not finalized; partial text will not be inserted",
      {
        terminationTimedOut: stopResult?.terminationTimedOut === true,
        hasFinalText: Boolean(manager.streamingFinalText),
        hasPartialText: Boolean(manager.streamingPartialText),
      },
      "streaming"
    );
    manager.emitError(
      {
        title: "Transcription incomplete",
        description:
          "EchoDraft could not confirm the end of this streaming transcription, so no partial text was inserted. Please dictate it again.",
        context: manager.streamingContext,
      },
      error
    );
    return false;
  }

  finalText = manager.streamingFinalText || "";

  if (!finalText && manager.streamingPartialText) {
    finalText = manager.streamingPartialText;
    logger.debug("Using partial text as fallback", { textLength: finalText.length }, "streaming");
  }

  const terminationText =
    stopResult && typeof stopResult.text === "string" ? stopResult.text : null;
  if (terminationText) {
    if (!finalText || terminationText.length >= finalText.length) {
      finalText = terminationText;
      logger.debug(
        "Using disconnect result text",
        { textLength: finalText.length, previousLength: manager.streamingFinalText?.length ?? 0 },
        "streaming"
      );
    } else {
      logger.debug(
        "Keeping live transcript over disconnect result",
        {
          liveLength: finalText.length,
          terminationLength: terminationText.length,
        },
        "streaming"
      );
    }
  }

  cleanupStreamingListeners(manager);

  const stopAudioStats =
    stopResult && typeof stopResult === "object" && stopResult.audioStats
      ? stopResult.audioStats
      : null;

  const timings = {
    recordDurationMs,
    transcriptionProcessingDurationMs: Math.round(tTerminate - t0),
    streamingAudioCleanupMs: Math.round(tAudioCleanup - t0),
    streamingFlushWaitMs: Math.round(tForceEndpoint - tAudioCleanup),
    streamingTerminateRoundTripMs: Math.round(tTerminate - tForceEndpoint),
    streamingTotalStopMs: Math.round(tTerminate - t0),
    streamingAudioChunksForwarded: manager.streamingAudioChunkCount,
    streamingAudioBytesForwarded: manager.streamingAudioBytesSent,
    streamingAudioFirstChunkAt: manager.streamingAudioFirstChunkAt,
    streamingAudioLastChunkAt: manager.streamingAudioLastChunkAt,
    ...(stopAudioStats ? { streamingMainAudioStats: stopAudioStats } : {}),
    ...(typeof stopResult?.audioDuration === "number"
      ? { streamingAudioDurationSeconds: stopResult.audioDuration }
      : {}),
    ...(stopResult?.terminationTimedOut ? { streamingTerminationTimedOut: true } : {}),
  };

  logger.info(
    "Streaming stop timing",
    {
      durationSeconds,
      audioCleanupMs: Math.round(tAudioCleanup - t0),
      flushWaitMs: Math.round(tForceEndpoint - tAudioCleanup),
      terminateRoundTripMs: Math.round(tTerminate - tForceEndpoint),
      totalStopMs: Math.round(tTerminate - t0),
      audioChunksSent: manager.streamingAudioChunkCount,
      audioBytesSent: manager.streamingAudioBytesSent,
      audioFirstChunkAt: manager.streamingAudioFirstChunkAt,
      audioLastChunkAt: manager.streamingAudioLastChunkAt,
      textLength: finalText.length,
    },
    "streaming"
  );

  const rawText = finalText;
  let cleanup = null;

  const useReasoningModel = localStorage.getItem("useReasoningModel") === "true";
  if (useReasoningModel && finalText) {
    manager.emitProgress({
      stage: "cleaning",
      stageLabel: "Cleaning up",
      provider: ECHO_DRAFT_CLOUD_SOURCE,
      context: manager.streamingContext,
    });
    const reasoningStart = performance.now();
    const cloudReasoningMode = localStorage.getItem("cloudReasoningMode") || ECHO_DRAFT_CLOUD_MODE;
    let attemptedManagedCleanupModel = null;

    try {
      if (isEchoDraftCloudMode(cloudReasoningMode)) {
        const reasonResult = await manager.withSessionRefresh(
          async () => {
            const res = await invokeCancelableIpc(signal, (requestId) =>
              window.electronAPI.cloudReason(
                finalText,
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

        if (typeof manager.reasoningCleanupService?.validateCleanupCandidate !== "function") {
          throw new Error("Cleanup preservation validation is unavailable.");
        }

        const validated = manager.reasoningCleanupService.validateCleanupCandidate(
          rawText,
          reasonResult.text
        );
        finalText = validated.text;
        cleanup = {
          requested: true,
          attempted: true,
          applied: true,
          status: finalText === rawText ? "unchanged" : "applied",
          fallbackReason: null,
          model: attemptedManagedCleanupModel,
          appliedModel: attemptedManagedCleanupModel,
          modelSource: "managed",
          provider: ECHO_DRAFT_CLOUD_SOURCE,
          retryCount: 0,
          metrics: validated.assessment.metrics,
        };

        const reasoningDurationMs = Math.round(performance.now() - reasoningStart);
        timings.reasoningProcessingDurationMs = reasoningDurationMs;
        logger.info(
          "Streaming reasoning complete",
          {
            reasoningDurationMs,
            model: reasonResult.model,
          },
          "streaming"
        );
      } else {
        const reasoningModel = localStorage.getItem("reasoningModel") || "";
        if (
          typeof manager.reasoningCleanupService?.processTranscriptionWithOutcome === "function"
        ) {
          const result = await manager.reasoningCleanupService.processTranscriptionWithOutcome(
            rawText,
            "assemblyai-streaming",
            null,
            runtime
          );
          finalText = result.text || rawText;
          cleanup = result.cleanup;
        } else if (reasoningModel) {
          const result =
            typeof manager.reasoningCleanupService?.processWithReasoningModelResult === "function"
              ? await manager.reasoningCleanupService.processWithReasoningModelResult(
                  rawText,
                  reasoningModel,
                  null,
                  runtime
                )
              : {
                  text: await manager.reasoningCleanupService.processWithReasoningModel(
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
          finalText = result.text;
          cleanup = {
            requested: true,
            attempted: true,
            applied: true,
            status: finalText === rawText ? "unchanged" : "applied",
            fallbackReason: null,
            model: reasoningModel,
            appliedModel: result.appliedModel || reasoningModel,
            modelSource: "selected",
            provider: localStorage.getItem("reasoningProvider") || "auto",
            retryCount: result.retryCount,
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
        const reasoningDurationMs = Math.round(performance.now() - reasoningStart);
        timings.reasoningProcessingDurationMs = reasoningDurationMs;
        logger.info("Streaming BYOK reasoning complete", { reasoningDurationMs }, "streaming");
      }
    } catch (reasonError) {
      if (isTranscriptionCancelled(reasonError, signal)) {
        throw createTranscriptionCancelledError();
      }
      finalText = rawText;
      const managedCleanup = isEchoDraftCloudMode(cloudReasoningMode);
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
      logger.error(
        "Streaming reasoning failed, using raw text",
        { error: reasonError.message },
        "streaming"
      );
    }
  }

  throwIfTranscriptionCancelled(signal);
  if (finalText) {
    const tBeforePaste = performance.now();
    logger.info(
      "Streaming transcription finalized",
      {
        context: manager.streamingContext,
        source: "assemblyai-streaming",
        rawLength: rawText.length,
        cleanedLength: finalText.length,
      },
      "transcription"
    );
    await Promise.resolve(
      manager.onTranscriptionComplete?.(
        {
          success: true,
          text: finalText,
          rawText,
          source: "assemblyai-streaming",
          timings,
          context: manager.streamingContext,
          ...(cleanup ? { cleanup } : {}),
        },
        { signal }
      )
    );
    throwIfTranscriptionCancelled(signal);

    logger.info(
      "Streaming total processing",
      {
        totalProcessingMs: Math.round(tBeforePaste - t0),
        hasReasoning: useReasoningModel,
      },
      "streaming"
    );
  }

  return true;
}
