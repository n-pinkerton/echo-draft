import logger from "../../../utils/logger";
import { getBaseLanguageCode } from "../../../utils/languageSupport";
import { countWords } from "../utils/wordCount";
import { raceWithAbort } from "../../../utils/retry";
import { getOrCreateAudioContext } from "./streamingAudioContext";
import { cleanupStreaming } from "./assemblyAiStreamingCleanup";

let streamingStartupSequence = 0;
export const STREAMING_STARTUP_TIMEOUT_MS = 30_000;

const createStartupCancellationError = (message, code = "STREAMING_START_CANCELLED") => {
  const error = new Error(message);
  error.code = code;
  return error;
};

export function cancelStreamingStartup(
  manager,
  reason = createStartupCancellationError("Streaming startup was cancelled")
) {
  if (!manager.streamingStartInProgress || manager.isStreaming) return false;

  manager.streamingStartupGeneration = (manager.streamingStartupGeneration || 0) + 1;
  const controller = manager.streamingStartAbortController;
  manager.streamingStartAbortController = null;
  manager.streamingStartInProgress = false;
  if (controller && !controller.signal.aborted) controller.abort(reason);
  try {
    Promise.resolve(window.electronAPI?.assemblyAiStreamingStop?.()).catch(() => {});
  } catch {
    // Ignore teardown failures while cancelling startup.
  }
  return true;
}

const acquireMicrophoneForStartup = (constraints, startupController) =>
  new Promise((resolve, reject) => {
    const { signal } = startupController;
    let settled = false;
    const cancellationError = () =>
      signal.reason || new Error("Streaming startup was cancelled");
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(cancellationError());
    };
    signal.addEventListener("abort", onAbort, { once: true });

    navigator.mediaDevices.getUserMedia(constraints).then(
      (stream) => {
        if (signal.aborted) {
          stream.getTracks?.().forEach((track) => track.stop());
          if (!settled) {
            settled = true;
            reject(cancellationError());
          }
          return;
        }
        if (!settled) {
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve(stream);
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      }
    );
  });

export async function startStreamingRecording(manager, context = null) {
  if (manager.streamingStartInProgress) {
    return false;
  }
  manager.streamingStartInProgress = true;
  const startupController = new AbortController();
  const startupGeneration = (manager.streamingStartupGeneration || 0) + 1;
  manager.streamingStartupGeneration = startupGeneration;
  const startupRequestId = `streaming-${Date.now()}-${++streamingStartupSequence}`;
  manager.streamingStartAbortController = startupController;
  const startupTimeoutId = setTimeout(() => {
    if (
      manager.streamingStartupGeneration === startupGeneration &&
      manager.streamingStartAbortController === startupController
    ) {
      cancelStreamingStartup(
        manager,
        createStartupCancellationError(
          "Streaming startup timed out",
          "STREAMING_START_TIMEOUT"
        )
      );
    }
  }, STREAMING_STARTUP_TIMEOUT_MS);
  const throwIfStartupInvalid = () => {
    if (
      startupController.signal.aborted ||
      manager.streamingStartupGeneration !== startupGeneration ||
      manager.streamingStartAbortController !== startupController
    ) {
      throw (
        startupController.signal.reason ||
        createStartupCancellationError("Streaming startup was cancelled")
      );
    }
  };
  let acquiredStream = null;
  let backendStarted = false;
  try {
    if (manager.isRecording || manager.isStreaming || manager.isProcessing) {
      return false;
    }

    const recordingContext = context && typeof context === "object" ? context : null;

    const t0 = performance.now();
    const constraints = await manager.getAudioConstraints();
    throwIfStartupInvalid();
    const tConstraints = performance.now();

    // Run getUserMedia and WebSocket connect in parallel.
    // With warmup, WS resolves in ~5ms; getUserMedia (~500ms) dominates.
    const microphonePromise = acquireMicrophoneForStartup(constraints, startupController);
    const backendPromise = manager.withSessionRefresh(async () => {
        if (startupController.signal.aborted) {
          throw startupController.signal.reason || new Error("Streaming startup was cancelled");
        }
        const res = await window.electronAPI.assemblyAiStreamingStart({
          sampleRate: 16000,
          language: getBaseLanguageCode(localStorage.getItem("preferredLanguage")),
          startupRequestId,
        });

        if (!res.success) {
          if (res.code === "NO_API") {
            return { needsFallback: true };
          }
          const err = new Error(res.error || "Failed to start streaming session");
          err.code = res.code;
          if (res.code === "STREAMING_START_CANCELLED" || res.code === "STREAMING_TOKEN_TIMEOUT") {
            startupController.abort(err);
          }
          throw err;
        }
        if (startupController.signal.aborted) {
          await window.electronAPI.assemblyAiStreamingStop?.().catch(() => {});
          throw startupController.signal.reason || new Error("Streaming startup was cancelled");
        }
        return res;
      }, { signal: startupController.signal });
    const [streamOutcome, resultOutcome] = await Promise.allSettled([
      microphonePromise,
      raceWithAbort(backendPromise, startupController.signal),
    ]);
    if (streamOutcome.status === "rejected") {
      if (resultOutcome.status === "fulfilled" && resultOutcome.value?.success) {
        await window.electronAPI.assemblyAiStreamingStop?.().catch(() => {});
      }
      throw streamOutcome.reason;
    }
    acquiredStream = streamOutcome.value;
    if (resultOutcome.status === "rejected") {
      throw resultOutcome.reason;
    }
    throwIfStartupInvalid();
    const stream = acquiredStream;
    const result = resultOutcome.value;
    backendStarted = result?.success === true;
    const tParallel = performance.now();
    try {
      localStorage?.setItem?.("micPermissionGranted", "true");
    } catch {
      // Ignore persistence errors
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      const settings = audioTrack.getSettings();
      logger.info(
        "Streaming recording started with microphone",
        {
          label: audioTrack.label,
          deviceId: settings.deviceId?.slice(0, 20) + "...",
          sampleRate: settings.sampleRate,
          usedCachedId: !!manager.cachedMicDeviceId,
        },
        "audio"
      );
    }

    if (result.needsFallback) {
      stream.getTracks().forEach((track) => track.stop());
      logger.debug(
        "Streaming API not configured, falling back to regular recording",
        {},
        "streaming"
      );
      return manager.startRecording(recordingContext);
    }

    const audioContext = await getOrCreateAudioContext(manager);
    throwIfStartupInvalid();
    manager.streamingAudioContext = audioContext;
    manager.streamingSource = audioContext.createMediaStreamSource(stream);
    manager.streamingStream = stream;
    acquiredStream = null;

    if (!manager.workletModuleLoaded) {
      await audioContext.audioWorklet.addModule(manager.streamingWorklet.getWorkletBlobUrl());
      throwIfStartupInvalid();
      manager.workletModuleLoaded = true;
    }

    manager.streamingProcessor = new AudioWorkletNode(audioContext, "pcm-streaming-processor");
    manager.streamingProcessor.port.onmessage = (event) =>
      manager.streamingWorklet.handleMessage(event);

    // Attach context early so per-chunk telemetry can correlate immediately.
    manager.streamingContext = recordingContext;
    manager.streamingAudioChunkCount = 0;
    manager.streamingAudioBytesSent = 0;
    manager.streamingAudioFirstChunkAt = null;
    manager.streamingAudioLastChunkAt = null;

    // Forward audio as soon as the pipeline is connected.
    manager.streamingAudioForwarding = true;
    manager.streamingSource.connect(manager.streamingProcessor);
    throwIfStartupInvalid();

    const tReady = performance.now();
    logger.info(
      "Streaming start timing",
      {
        constraintsMs: Math.round(tConstraints - t0),
        getUserMediaAndWsMs: Math.round(tParallel - tConstraints),
        pipelineMs: Math.round(tReady - tParallel),
        totalMs: Math.round(tReady - t0),
        usedWarmConnection: result.usedWarmConnection,
        micDriverWarmedUp: !!manager.micDriverWarmedUp,
      },
      "streaming"
    );

    // Show recording indicator only AFTER mic is live and audio pipeline is connected.
    // This ensures no words are lost — the user sees "recording" exactly when audio flows.
    manager.isStreaming = true;
    manager.isRecording = true;
    manager.recordingStartTime = Date.now();
    manager.emitStateChange({ isRecording: true, isProcessing: false, isStreaming: true });
    manager.emitProgress({
      stage: "listening",
      stageLabel: "Listening",
      stageProgress: null,
      context: recordingContext,
    });

    manager.streamingFinalText = "";
    manager.streamingPartialText = "";
    manager.streamingTextResolve = null;
    manager.streamingTextDebounce = null;

    const partialCleanup = window.electronAPI.onAssemblyAiPartialTranscript((text) => {
      manager.streamingPartialText = text;
      try {
        manager.onPartialTranscript?.(text);
      } catch (error) {
        logger.error(
          "onPartialTranscript handler failed",
          { error: error?.message || String(error), stack: error?.stack },
          "transcription"
        );
      }
      manager.emitProgress({
        generatedChars: text.length,
        generatedWords: countWords(text),
      });
    });

    const finalCleanup = window.electronAPI.onAssemblyAiFinalTranscript((text) => {
      manager.streamingFinalText = text;
      manager.streamingPartialText = "";
      try {
        manager.onPartialTranscript?.(text);
      } catch (error) {
        logger.error(
          "onPartialTranscript handler failed",
          { error: error?.message || String(error), stack: error?.stack },
          "transcription"
        );
      }
      manager.emitProgress({
        generatedChars: text.length,
        generatedWords: countWords(text),
      });
    });

    const errorCleanup = window.electronAPI.onAssemblyAiError((error) => {
      logger.error("AssemblyAI streaming error", { error }, "streaming");
      manager.emitError(
        {
          title: "Streaming Error",
          description: error,
        },
        error
      );
      if (manager.isStreaming) {
        logger.warn("Connection lost during streaming, auto-stopping", {}, "streaming");
        manager.stopStreamingRecording().catch((e) => {
          logger.error("Auto-stop after connection loss failed", { error: e.message }, "streaming");
        });
      }
    });

    const sessionEndCleanup = window.electronAPI.onAssemblyAiSessionEnd((data) => {
      logger.debug("AssemblyAI session ended", data, "streaming");
      if (data.text) {
        manager.streamingFinalText = data.text;
      }
    });

    manager.streamingCleanupFns = [partialCleanup, finalCleanup, errorCleanup, sessionEndCleanup];

    backendStarted = false;
    return true;
  } catch (error) {
    const effectiveError = startupController.signal.aborted
      ? startupController.signal.reason || error
      : error;
    const errorMessage =
      effectiveError?.message ??
      (typeof effectiveError === "string"
        ? effectiveError
        : typeof effectiveError?.toString === "function"
          ? effectiveError.toString()
          : String(effectiveError));
    const errorName = effectiveError?.name;
    const errorCode = effectiveError?.code;

    const wasCancelled = errorCode === "STREAMING_START_CANCELLED";
    if (!wasCancelled) {
      logger.error("Failed to start streaming recording", { error: errorMessage }, "streaming");
    }

    manager.streamingContext = null;
    let errorTitle = "Streaming Error";
    let errorDescription = `Failed to start streaming: ${errorMessage}`;

    if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
      errorTitle = "Microphone Access Denied";
      errorDescription =
        "Please grant microphone permission in your system settings and try again.";
    } else if (errorCode === "AUTH_EXPIRED" || errorCode === "AUTH_REQUIRED") {
      errorTitle = "Sign-in Required";
      errorDescription =
        "Your EchoDraft Cloud session is unavailable. Please sign in again from Settings.";
    }

    if (!wasCancelled) {
      manager.emitError(
        {
          title: errorTitle,
          description: errorDescription,
        },
        effectiveError
      );
    }

    if (acquiredStream) {
      acquiredStream.getTracks?.().forEach((track) => track.stop());
      acquiredStream = null;
    }
    if (backendStarted) {
      await window.electronAPI.assemblyAiStreamingStop?.().catch(() => {});
      backendStarted = false;
    }
    await cleanupStreaming(manager);
    return false;
  } finally {
    clearTimeout(startupTimeoutId);
    if (manager.streamingStartAbortController === startupController) {
      manager.streamingStartAbortController = null;
    }
    if (manager.streamingStartupGeneration === startupGeneration) {
      manager.streamingStartInProgress = false;
    }
  }
}
