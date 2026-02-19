import logger from "../../../utils/logger";
import { getCustomDictionaryArray } from "../transcription/customDictionary";
import { cleanupStreamingListeners } from "./assemblyAiStreamingCleanup";

const STREAMING_WORKLET_FLUSH_TIMEOUT_MS = 1000;
const STREAMING_POST_FLUSH_GRACE_MS = 150;

export async function stopStreamingRecording(manager) {
  if (!manager.isStreaming) return false;

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
  manager.recordingStartTime = null;
  manager.emitStateChange({ isRecording: false, isProcessing: true, isStreaming: false });
  manager.emitProgress({
    stage: "transcribing",
    stageLabel: "Transcribing",
    message: "Finalizing stream",
    context: manager.streamingContext,
  });

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
  const tAudioCleanup = performance.now();

  // 3. Wait for flushed buffer to travel: port → main thread → IPC → WebSocket → server.
  //    The worklet posts a FLUSH_DONE sentinel after posting the final buffer.
  if (flushWaiter) {
    await Promise.race([
      flushWaiter.promise,
      new Promise((resolve) => setTimeout(resolve, STREAMING_WORKLET_FLUSH_TIMEOUT_MS)),
    ]);
    manager.streamingWorklet.resolveFlushWaiter();
  }
  await new Promise((resolve) => setTimeout(resolve, STREAMING_POST_FLUSH_GRACE_MS));
  manager.streamingAudioForwarding = false;
  manager.isStreaming = false;

  // 4. ForceEndpoint finalizes any in-progress turn, then Terminate closes the session.
  //    The server MUST process ALL remaining audio and send ALL Turn messages before
  //    responding with Termination — so awaiting this guarantees we get every word.
  window.electronAPI.assemblyAiStreamingForceEndpoint?.();
  const tForceEndpoint = performance.now();

  const stopResult = await window.electronAPI.assemblyAiStreamingStop().catch((e) => {
    logger.debug("Streaming disconnect error", { error: e.message }, "streaming");
    return { success: false };
  });
  const tTerminate = performance.now();

  finalText = manager.streamingFinalText || "";

  if (!finalText && manager.streamingPartialText) {
    finalText = manager.streamingPartialText;
    logger.debug("Using partial text as fallback", { textLength: finalText.length }, "streaming");
  }

  const terminationText = stopResult && typeof stopResult.text === "string" ? stopResult.text : null;
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
    stopResult && typeof stopResult === "object" && stopResult.audioStats ? stopResult.audioStats : null;

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

  const useReasoningModel = localStorage.getItem("useReasoningModel") === "true";
  if (useReasoningModel && finalText) {
    manager.emitProgress({
      stage: "cleaning",
      stageLabel: "Cleaning up",
      provider: "openwhispr",
      context: manager.streamingContext,
    });
    const reasoningStart = performance.now();
    const agentName = localStorage.getItem("agentName") || "";
    const cloudReasoningMode = localStorage.getItem("cloudReasoningMode") || "openwhispr";

    try {
      if (cloudReasoningMode === "openwhispr") {
        const reasonResult = await manager.withSessionRefresh(async () => {
          const res = await window.electronAPI.cloudReason(finalText, {
            agentName,
            customDictionary: getCustomDictionaryArray(),
            language: localStorage.getItem("preferredLanguage") || "auto",
          });
          if (!res.success) {
            const err = new Error(res.error || "Cloud reasoning failed");
            err.code = res.code;
            throw err;
          }
          return res;
        });

        if (reasonResult.success && reasonResult.text) {
          finalText = reasonResult.text;
        }

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
        if (reasoningModel) {
          const result = await manager.reasoningCleanupService.processWithReasoningModel(
            finalText,
            reasoningModel,
            agentName
          );
          if (result) {
            finalText = result;
          }
          const reasoningDurationMs = Math.round(performance.now() - reasoningStart);
          timings.reasoningProcessingDurationMs = reasoningDurationMs;
          logger.info("Streaming BYOK reasoning complete", { reasoningDurationMs }, "streaming");
        }
      }
    } catch (reasonError) {
      logger.error(
        "Streaming reasoning failed, using raw text",
        { error: reasonError.message },
        "streaming"
      );
    }
  }

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
    if (typeof window !== "undefined" && window.__openwhisprLogLevel === "trace") {
      logger.trace(
        "Streaming transcript text",
        {
          context: manager.streamingContext,
          source: "assemblyai-streaming",
          rawText,
          cleanedText: finalText,
        },
        "transcription"
      );
    }
    await Promise.resolve(
      manager.onTranscriptionComplete?.({
        success: true,
        text: finalText,
        rawText,
        source: "assemblyai-streaming",
        timings,
        context: manager.streamingContext,
      })
    );

    logger.info(
      "Streaming total processing",
      {
        totalProcessingMs: Math.round(tBeforePaste - t0),
        hasReasoning: useReasoningModel,
      },
      "streaming"
    );
  }

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
    manager.warmupStreamingConnection().catch((e) => {
      logger.debug("Background re-warm failed", { error: e.message }, "streaming");
    });
  }

  return true;
}

