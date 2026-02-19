import logger from "../../../utils/logger";
import { getBaseLanguageCode } from "../../../utils/languageSupport";
import { countWords } from "../utils/wordCount";
import { getOrCreateAudioContext } from "./streamingAudioContext";
import { cleanupStreaming } from "./assemblyAiStreamingCleanup";

export async function startStreamingRecording(manager, context = null) {
  try {
    if (manager.isRecording || manager.isStreaming || manager.isProcessing) {
      return false;
    }

    const recordingContext = context && typeof context === "object" ? context : null;

    const t0 = performance.now();
    const constraints = await manager.getAudioConstraints();
    const tConstraints = performance.now();

    // Run getUserMedia and WebSocket connect in parallel.
    // With warmup, WS resolves in ~5ms; getUserMedia (~500ms) dominates.
    const [stream, result] = await Promise.all([
      navigator.mediaDevices.getUserMedia(constraints),
      manager.withSessionRefresh(async () => {
        const res = await window.electronAPI.assemblyAiStreamingStart({
          sampleRate: 16000,
          language: getBaseLanguageCode(localStorage.getItem("preferredLanguage")),
        });

        if (!res.success) {
          if (res.code === "NO_API") {
            return { needsFallback: true };
          }
          const err = new Error(res.error || "Failed to start streaming session");
          err.code = res.code;
          throw err;
        }
        return res;
      }),
    ]);
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
    manager.streamingAudioContext = audioContext;
    manager.streamingSource = audioContext.createMediaStreamSource(stream);
    manager.streamingStream = stream;

    if (!manager.workletModuleLoaded) {
      await audioContext.audioWorklet.addModule(manager.streamingWorklet.getWorkletBlobUrl());
      manager.workletModuleLoaded = true;
    }

    manager.streamingProcessor = new AudioWorkletNode(audioContext, "pcm-streaming-processor");
    manager.streamingProcessor.port.onmessage = (event) => manager.streamingWorklet.handleMessage(event);

    // Attach context early so per-chunk telemetry can correlate immediately.
    manager.streamingContext = recordingContext;
    manager.streamingAudioChunkCount = 0;
    manager.streamingAudioBytesSent = 0;
    manager.streamingAudioFirstChunkAt = null;
    manager.streamingAudioLastChunkAt = null;

    // Forward audio as soon as the pipeline is connected.
    manager.streamingAudioForwarding = true;
    manager.streamingSource.connect(manager.streamingProcessor);

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
          logger.error(
            "Auto-stop after connection loss failed",
            { error: e.message },
            "streaming"
          );
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

    return true;
  } catch (error) {
    const errorMessage =
      error?.message ??
      (typeof error === "string"
        ? error
        : typeof error?.toString === "function"
          ? error.toString()
          : String(error));
    const errorName = error?.name;
    const errorCode = error?.code;

    logger.error("Failed to start streaming recording", { error: errorMessage }, "streaming");

    manager.streamingContext = null;
    let errorTitle = "Streaming Error";
    let errorDescription = `Failed to start streaming: ${errorMessage}`;

    if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
      errorTitle = "Microphone Access Denied";
      errorDescription = "Please grant microphone permission in your system settings and try again.";
    } else if (errorCode === "AUTH_EXPIRED" || errorCode === "AUTH_REQUIRED") {
      errorTitle = "Sign-in Required";
      errorDescription =
        "Your EchoDraft Cloud session is unavailable. Please sign in again from Settings.";
    }

    manager.emitError(
      {
        title: errorTitle,
        description: errorDescription,
      },
      error
    );

    await cleanupStreaming(manager);
    return false;
  }
}

