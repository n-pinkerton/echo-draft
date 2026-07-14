import logger from "../../../utils/logger";
import { getRendererLogLevel } from "../../../utils/branding";
import { describeRecordingStartError } from "./nonStreamingRecordingErrors";
import { waitForNonStreamingStopFlush } from "./nonStreamingStopFlush";
import {
  armNonStreamingStopWatchdog,
  clearNonStreamingStopWatchdog,
  retireNonStreamingRecorderWithoutEnqueue,
} from "./nonStreamingStopWatchdog";

export async function startNonStreamingRecording(manager, context = null) {
  let acquiredStream = null;
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
    acquiredStream = stream;
    const tStream = performance.now();
    try {
      localStorage?.setItem?.("micPermissionGranted", "true");
    } catch {
      // Ignore persistence errors
    }

    const audioTrack = stream.getAudioTracks()[0];
    let microphoneLabel = null;
    let microphoneSettings = {};
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
      microphoneLabel = audioTrack.label || null;
      microphoneSettings = settings || {};
      logger.info(
        "Recording started with microphone",
        {
          deviceSelected: Boolean(settings.deviceId),
          sampleRate: settings.sampleRate,
          channelCount: settings.channelCount,
          context: recordingContext,
        },
        "audio"
      );
    }

    const mediaRecorder = new MediaRecorder(stream);
    const recorderGeneration = (Number(manager.nonStreamingRecorderGeneration) || 0) + 1;
    manager.nonStreamingRecorderGeneration = recorderGeneration;
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

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
      if (getRendererLogLevel() === "trace") {
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

    let stopEventHandled = false;
    mediaRecorder.onstop = async () => {
      if (stopEventHandled || manager.nonStreamingRecorderGeneration !== recorderGeneration) {
        return;
      }
      stopEventHandled = true;
      clearNonStreamingStopWatchdog(manager);
      const stopContext =
        manager.pendingNonStreamingStopContext || manager.pendingStopContext || {};
      const startTimings = manager.pendingNonStreamingStartTimings || null;
      let flushContext = null;
      let recordingClosedSuccessfully = false;

      // The browser has closed this recorder even if flushing or queueing later
      // fails. Never leave EchoDraft believing a dead recorder is still live.
      manager.isRecording = false;
      if (manager.mediaRecorder === mediaRecorder) {
        manager.mediaRecorder = null;
      }

      try {
        flushContext = await waitForNonStreamingStopFlush(manager, stopContext);
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

        const durationSeconds = recordingStartedAt
          ? (Date.now() - recordingStartedAt) / 1000
          : null;
        const queueResult = manager.enqueueProcessingJob(
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
            microphoneLabel,
            microphoneSampleRate: microphoneSettings.sampleRate ?? null,
            microphoneChannelCount: microphoneSettings.channelCount ?? null,
          },
          recordingContext
        );
        const jobsAhead = Math.max(0, Number(queueResult?.jobsAhead) || 0);
        const queued = jobsAhead > 0;
        manager.emitProgress({
          stage: queued ? "queued" : "transcribing",
          stageLabel: queued ? "Queued" : "Transcribing",
          message: queued
            ? `${jobsAhead} ${jobsAhead === 1 ? "dictation" : "dictations"} ahead`
            : "Recording stopped",
          context: recordingContext,
          recordingClosed: true,
        });
        manager.pendingNonStreamingStopRequestedAt = null;
        manager.pendingNonStreamingStartTimings = null;
        manager.emitStateChange({
          isRecording: false,
          isProcessing: manager.isProcessing,
          isStreaming: manager.isStreaming,
        });

        recordingClosedSuccessfully = true;
      } catch (error) {
        logger.error(
          "Failed to close and enqueue recording",
          {
            error: error?.message || String(error),
            sessionId: recordingContext?.sessionId || null,
            jobId: recordingContext?.jobId ?? null,
          },
          "audio"
        );
        manager.emitError(
          {
            title: "Recording Error",
            description:
              "The recording closed, but EchoDraft could not queue it for transcription.",
            context: recordingContext,
          },
          error
        );
      } finally {
        stream.getTracks().forEach((track) => track.stop());
        manager.isStopping = false;
        manager.pendingNonStreamingStopRequestedAt = null;
        manager.pendingNonStreamingStartTimings = null;
        manager.pendingNonStreamingStopContext = null;
        manager.pendingStopContext = null;
        if (!recordingClosedSuccessfully) {
          manager.emitStateChange({
            isRecording: false,
            isProcessing: manager.isProcessing,
            isStreaming: manager.isStreaming,
          });
        }
        const resolveStop = manager.resolveNonStreamingStop;
        manager.resolveNonStreamingStop = null;
        manager.nonStreamingStopPromise = null;
        resolveStop?.(recordingClosedSuccessfully);
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
    manager.emitProgress({
      stage: "listening",
      stageLabel: "Listening",
      stageProgress: null,
      context: recordingContext,
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
    acquiredStream?.getTracks?.().forEach((track) => track.stop());
    if (manager.mediaRecorder?.stream === acquiredStream) {
      manager.mediaRecorder = null;
    }
    manager.audioChunks = [];
    manager.recordingStartTime = null;
    manager.pendingNonStreamingStartTimings = null;
    manager.pendingNonStreamingStopContext = null;
    manager.pendingNonStreamingStopRequestedAt = null;
    manager.pendingStopContext = null;
    manager.isStopping = false;
    manager.isRecording = false;
    manager.emitStateChange({
      isRecording: false,
      isProcessing: manager.isProcessing,
      isStreaming: false,
    });

    const errorInfo = describeRecordingStartError(error);

    logger.error(
      "Failed to start recording",
      {
        error: errorInfo.errorMessage,
        name: errorInfo.errorName,
        stack: error?.stack,
        context,
      },
      "audio"
    );
    manager.emitError(
      {
        title: errorInfo.title,
        description: errorInfo.description,
        context,
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
  manager.nonStreamingStopPromise = new Promise((resolve) => {
    manager.resolveNonStreamingStop = resolve;
  });

  try {
    if (typeof manager.mediaRecorder.requestData === "function") {
      manager.mediaRecorder.requestData();
    }
    const mediaRecorder = manager.mediaRecorder;
    armNonStreamingStopWatchdog(manager, {
      mediaRecorder,
      stream: mediaRecorder.stream,
      recorderGeneration: manager.nonStreamingRecorderGeneration,
      context: nextContext,
    });
    mediaRecorder.stop();
    return true;
  } catch (error) {
    clearNonStreamingStopWatchdog(manager);
    manager.resolveNonStreamingStop?.(false);
    manager.resolveNonStreamingStop = null;
    manager.nonStreamingStopPromise = null;
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
    const mediaRecorder = manager.mediaRecorder;
    const recorderGeneration = manager.nonStreamingRecorderGeneration;
    const stream = mediaRecorder.stream;
    manager.pendingNonStreamingStopRequestedAt = Date.now();
    manager.pendingNonStreamingStartTimings = null;
    const cancellationContext = {
      requestedAt: manager.pendingNonStreamingStopRequestedAt,
      reason: "cancel",
      source: "cancelled",
    };
    manager.pendingNonStreamingStopContext = cancellationContext;
    manager.pendingStopContext = cancellationContext;
    manager.isStopping = true;

    let cancellationSettled = false;
    const settleCancellation = () => {
      if (cancellationSettled) {
        return;
      }
      cancellationSettled = true;
      const retired = retireNonStreamingRecorderWithoutEnqueue(manager, {
        mediaRecorder,
        stream,
        recorderGeneration,
      });
      if (!retired) {
        return;
      }
      manager.emitProgress({
        stage: "cancelled",
        stageLabel: "Cancelled",
      });
    };
    mediaRecorder.onstop = settleCancellation;

    try {
      mediaRecorder.stop();
    } catch (error) {
      logger.warn(
        "Cancelled recorder could not dispatch stop; retiring it without audio",
        { error: error?.message || String(error) },
        "audio"
      );
    } finally {
      // Cancellation intentionally discards every chunk, so it does not need to
      // wait for MediaRecorder.onstop. Retire immediately and generation-fence
      // any callback the browser may already have queued.
      settleCancellation();
    }

    return true;
  }
  return false;
}
