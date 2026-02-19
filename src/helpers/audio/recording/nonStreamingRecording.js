import logger from "../../../utils/logger";

const NON_STREAMING_STOP_FLUSH_MS = 60;

const sleep = (ms = 0) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForStopFlush = async (manager, stopContext = null) => {
  const stopRequestedAt =
    typeof stopContext?.requestedAt === "number" ? stopContext.requestedAt : null;
  const now = Date.now();
  const stopLatencyToFlushStartMs = stopRequestedAt ? Math.max(0, now - stopRequestedAt) : null;

  const flushStartedAt = Date.now();
  if (NON_STREAMING_STOP_FLUSH_MS > 0) {
    await sleep(NON_STREAMING_STOP_FLUSH_MS);
  }
  const stopFlushMs = Date.now() - flushStartedAt;

  return {
    stopLatencyToFlushStartMs,
    stopFlushMs,
    chunksAtStopStart: manager.audioChunks.length,
    chunksAfterStopWait: manager.audioChunks.length,
  };
};

export async function startNonStreamingRecording(manager, context = null) {
  try {
    if (manager.isRecording || manager.mediaRecorder?.state === "recording" || manager.isStopping) {
      logger.debug(
        "Start recording blocked during stop in progress",
        {
          isRecording: manager.isRecording,
          mediaRecorderState: manager.mediaRecorder?.state || null,
          isStopping: manager.isStopping,
          context,
        },
        "audio"
      );
      return false;
    }

    const recordingContext = context && typeof context === "object" ? context : null;
    const startCallAt = Date.now();
    const hotkeyToStartCallMs =
      typeof recordingContext?.triggeredAt === "number"
        ? Math.max(0, startCallAt - recordingContext.triggeredAt)
        : null;
    const t0 = performance.now();
    const constraints = await manager.getAudioConstraints();
    const tConstraints = performance.now();
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const tStream = performance.now();
    try {
      localStorage?.setItem?.("micPermissionGranted", "true");
    } catch {
      // Ignore persistence errors
    }

    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      const maybeSetAutoStopContext = (reason, source) => {
        if (manager.pendingNonStreamingStopContext || manager.pendingStopContext) {
          return;
        }
        const requestedAt = Date.now();
        const nextContext = {
          requestedAt,
          reason,
          source,
          sessionId: recordingContext?.sessionId,
          outputMode: recordingContext?.outputMode,
          chunksBeforeStop: manager.audioChunks?.length ?? 0,
        };
        manager.pendingNonStreamingStopContext = nextContext;
        manager.pendingStopContext = nextContext;
      };

      const handleEnded = () => maybeSetAutoStopContext("track-ended", "track-ended");
      try {
        audioTrack.addEventListener?.("ended", handleEnded);
      } catch {
        // Ignore
      }
      try {
        audioTrack.onended = handleEnded;
      } catch {
        // Ignore
      }

      const settings = audioTrack.getSettings();
      logger.info(
        "Recording started with microphone",
        {
          label: audioTrack.label,
          deviceId: settings.deviceId?.slice(0, 20) + "...",
          sampleRate: settings.sampleRate,
          channelCount: settings.channelCount,
          context: recordingContext,
        },
        "audio"
      );
    }

    const mediaRecorder = new MediaRecorder(stream);
    const audioChunks = [];
    const recordingStartedAt = Date.now();
    const recordingMimeType = mediaRecorder.mimeType || "audio/webm";
    const tRecorderInit = performance.now();
    const startTimings = {
      hotkeyToStartCallMs,
      hotkeyToRecorderStartMs: null,
      startConstraintsMs: Math.round(tConstraints - t0),
      startGetUserMediaMs: Math.round(tStream - tConstraints),
      startMediaRecorderInitMs: Math.round(tRecorderInit - tStream),
      startMediaRecorderStartMs: null,
      startTotalMs: null,
    };

    manager.mediaRecorder = mediaRecorder;
    manager.audioChunks = audioChunks;
    manager.recordingMimeType = recordingMimeType;
    manager.pendingNonStreamingStartTimings = startTimings;
    manager.pendingNonStreamingStopContext = null;
    manager.pendingNonStreamingStopRequestedAt = null;
    manager.pendingStopContext = null;
    manager.isStopping = false;
    manager.recordingStartTime = recordingStartedAt;
    manager.emitProgress({
      stage: "listening",
      stageLabel: "Listening",
      stageProgress: null,
      context: recordingContext,
    });

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
      if (typeof window !== "undefined" && window.__openwhisprLogLevel === "trace") {
        logger.trace(
          "MediaRecorder chunk captured",
          {
            context: recordingContext,
            chunkIndex: audioChunks.length,
            bytes: event?.data?.size,
            type: event?.data?.type,
            elapsedMs: Date.now() - recordingStartedAt,
          },
          "audio"
        );
      }
    };

    mediaRecorder.onstop = async () => {
      const stopContext =
        manager.pendingNonStreamingStopContext || manager.pendingStopContext || {};
      const flushContext = await waitForStopFlush(manager, stopContext);
      const startTimings = manager.pendingNonStreamingStartTimings || null;

      try {
        manager.isRecording = false;
        if (manager.mediaRecorder === mediaRecorder) {
          manager.mediaRecorder = null;
        }
        const stopRequestedAt =
          typeof stopContext.requestedAt === "number" ? stopContext.requestedAt : null;
        const stopLatencyMs = stopRequestedAt ? Math.max(0, Date.now() - stopRequestedAt) : null;
        const stopLatencyToFlushStartMs = flushContext?.stopLatencyToFlushStartMs ?? null;
        const stopFlushMs = flushContext?.stopFlushMs ?? null;

        const audioBlob = new Blob(audioChunks, { type: recordingMimeType });
        const chunksBeforeStopWait = flushContext?.chunksAtStopStart ?? audioChunks.length;
        const chunksAfterStopWait = flushContext?.chunksAfterStopWait ?? audioChunks.length;

        logger.info(
          "Recording stopped",
          {
            blobSize: audioBlob.size,
            blobType: audioBlob.type,
            chunksCount: audioChunks.length,
            stopReason: stopContext.reason || null,
            stopSource: stopContext.source || null,
            stopRequestedAt,
            stopLatencyMs,
            stopLatencyToFlushStartMs,
            stopFlushMs,
            chunksBeforeStopWait,
            chunksAfterStopWait,
            stopInProgress: true,
            durationSeconds:
              recordingStartedAt && stopRequestedAt
                ? (stopRequestedAt - recordingStartedAt) / 1000
                : null,
            context: recordingContext,
          },
          "audio"
        );

        void manager.saveDebugAudioCaptureIfEnabled(audioBlob, {
          sessionId: recordingContext?.sessionId || null,
          jobId: recordingContext?.jobId ?? null,
          outputMode: recordingContext?.outputMode || null,
          durationSeconds:
            recordingStartedAt && stopRequestedAt
              ? (stopRequestedAt - recordingStartedAt) / 1000
              : null,
          ...(startTimings || {}),
          stopReason: stopContext.reason || null,
          stopSource: stopContext.source || null,
        });

        const durationSeconds = recordingStartedAt ? (Date.now() - recordingStartedAt) / 1000 : null;
        manager.enqueueProcessingJob(
          audioBlob,
          {
            durationSeconds,
            ...(startTimings || {}),
            stopReason: stopContext.reason || null,
            stopSource: stopContext.source || null,
            chunksCount: audioChunks.length,
            stopLatencyMs,
            stopRequestedAt,
            stopAudioBlobAt: Date.now(),
            stopLatencyToFlushStartMs,
            stopFlushMs,
            chunksBeforeStopWait,
            chunksAfterStopWait,
          },
          recordingContext
        );
        manager.pendingNonStreamingStopRequestedAt = null;
        manager.pendingNonStreamingStartTimings = null;
        manager.emitStateChange({
          isRecording: false,
          isProcessing: manager.isProcessing,
          isStreaming: manager.isStreaming,
        });

        stream.getTracks().forEach((track) => track.stop());
      } finally {
        manager.isStopping = false;
        manager.pendingNonStreamingStopContext = null;
        manager.pendingStopContext = null;
      }
    };

    mediaRecorder.start();
    const tStarted = performance.now();
    startTimings.startMediaRecorderStartMs = Math.round(tStarted - tRecorderInit);
    startTimings.startTotalMs = Math.round(tStarted - t0);
    startTimings.hotkeyToRecorderStartMs =
      typeof recordingContext?.triggeredAt === "number"
        ? Math.max(0, Date.now() - recordingContext.triggeredAt)
        : null;
    manager.isRecording = true;
    manager.emitStateChange({
      isRecording: true,
      isProcessing: manager.isProcessing,
      isStreaming: false,
    });

    logger.info(
      "Non-streaming start timing",
      {
        hotkeyToStartCallMs: startTimings.hotkeyToStartCallMs,
        hotkeyToRecorderStartMs: startTimings.hotkeyToRecorderStartMs,
        constraintsMs: startTimings.startConstraintsMs,
        getUserMediaMs: startTimings.startGetUserMediaMs,
        mediaRecorderInitMs: startTimings.startMediaRecorderInitMs,
        mediaRecorderStartMs: startTimings.startMediaRecorderStartMs,
        totalMs: startTimings.startTotalMs,
        context: recordingContext,
      },
      "audio"
    );

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
    let errorTitle = "Recording Error";
    let errorDescription = `Failed to access microphone: ${errorMessage}`;

    if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
      errorTitle = "Microphone Access Denied";
      errorDescription = "Please grant microphone permission in your system settings and try again.";
    } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
      errorTitle = "No Microphone Found";
      errorDescription = "No microphone was detected. Please connect a microphone and try again.";
    } else if (errorName === "NotReadableError" || errorName === "TrackStartError") {
      errorTitle = "Microphone In Use";
      errorDescription =
        "The microphone is being used by another application. Please close other apps and try again.";
    }

    logger.error(
      "Failed to start recording",
      {
        error: error?.message || String(error),
        name: error?.name,
        stack: error?.stack,
        context,
      },
      "audio"
    );
    manager.emitError(
      {
        title: errorTitle,
        description: errorDescription,
      },
      error
    );
    return false;
  }
}

export function stopNonStreamingRecording(manager, stopContext = null) {
  if (manager.isStopping && manager.mediaRecorder?.state === "recording") {
    logger.debug(
      "Stop recording request ignored because stop already in progress",
      {
        context: stopContext,
        state: manager.getState(),
        pendingContext: manager.pendingNonStreamingStopContext,
      },
      "audio"
    );
    return true;
  }

  if (!manager.mediaRecorder) {
    return false;
  }

  if (manager.mediaRecorder.state !== "recording") {
    return false;
  }

  manager.pendingNonStreamingStopRequestedAt = Date.now();
  const requestedContext = stopContext && typeof stopContext === "object" ? stopContext : {};
  const nextContext = {
    requestedAt: manager.pendingNonStreamingStopRequestedAt,
    reason:
      typeof requestedContext.reason === "string" && requestedContext.reason.trim()
        ? requestedContext.reason.trim()
        : "manual",
    source:
      typeof requestedContext.source === "string" && requestedContext.source.trim()
        ? requestedContext.source.trim()
        : "manual",
    sessionId: requestedContext.sessionId,
    outputMode: requestedContext.outputMode,
    chunksBeforeStop: manager.audioChunks.length,
  };
  manager.pendingNonStreamingStopContext = nextContext;
  manager.pendingStopContext = nextContext;
  manager.isStopping = true;

  try {
    if (typeof manager.mediaRecorder.requestData === "function") {
      manager.mediaRecorder.requestData();
    }
    manager.mediaRecorder.stop();
    return true;
  } catch (error) {
    manager.isStopping = false;
    manager.pendingNonStreamingStopContext = null;
    manager.pendingStopContext = null;
    logger.error(
      "Failed to initiate non-streaming stop",
      { error: error?.message || String(error), context: nextContext },
      "audio"
    );
    return false;
  }
}

export function cancelNonStreamingRecording(manager) {
  if (manager.mediaRecorder && manager.mediaRecorder.state === "recording") {
    manager.pendingNonStreamingStopRequestedAt = Date.now();
    manager.pendingNonStreamingStartTimings = null;
    manager.pendingNonStreamingStopContext = {
      requestedAt: manager.pendingNonStreamingStopRequestedAt,
      reason: "cancel",
      source: "cancelled",
    };
    manager.mediaRecorder.onstop = () => {
      manager.isRecording = false;
      manager.audioChunks = [];
      manager.emitStateChange({
        isRecording: false,
        isProcessing: manager.isProcessing,
        isStreaming: false,
      });
      manager.emitProgress({
        stage: "cancelled",
        stageLabel: "Cancelled",
      });
    };

    manager.mediaRecorder.stop();

    if (manager.mediaRecorder.stream) {
      manager.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
    }

    return true;
  }
  return false;
}
