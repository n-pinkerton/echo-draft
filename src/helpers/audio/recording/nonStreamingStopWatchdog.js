import logger from "../../../utils/logger";

export const NON_STREAMING_STOP_EVENT_TIMEOUT_MS = 4_000;

export function clearNonStreamingStopWatchdog(manager) {
  if (manager.nonStreamingStopWatchdog !== null) {
    clearTimeout(manager.nonStreamingStopWatchdog);
    manager.nonStreamingStopWatchdog = null;
  }
}

export function retireNonStreamingRecorderWithoutEnqueue(
  manager,
  { mediaRecorder, stream, recorderGeneration }
) {
  if (
    manager.nonStreamingRecorderGeneration !== recorderGeneration ||
    manager.mediaRecorder !== mediaRecorder
  ) {
    return false;
  }

  clearNonStreamingStopWatchdog(manager);
  // Advance the generation before detaching callbacks. A callback that was
  // already queued by the browser must not enqueue discarded audio or clear a
  // replacement recorder.
  manager.nonStreamingRecorderGeneration = recorderGeneration + 1;
  mediaRecorder.onstop = null;
  mediaRecorder.ondataavailable = null;
  stream?.getTracks?.().forEach((track) => track.stop());

  manager.mediaRecorder = null;
  manager.audioChunks = [];
  manager.recordingStartTime = null;
  manager.isRecording = false;
  manager.isStopping = false;
  manager.pendingNonStreamingStopRequestedAt = null;
  manager.pendingNonStreamingStartTimings = null;
  manager.pendingNonStreamingStopContext = null;
  manager.pendingStopContext = null;

  const resolveStop = manager.resolveNonStreamingStop;
  manager.resolveNonStreamingStop = null;
  manager.nonStreamingStopPromise = null;
  resolveStop?.(false);

  manager.emitStateChange({
    isRecording: false,
    isProcessing: manager.isProcessing,
    isStreaming: manager.isStreaming,
  });
  return true;
}

export function armNonStreamingStopWatchdog(
  manager,
  { mediaRecorder, stream, recorderGeneration, context }
) {
  clearNonStreamingStopWatchdog(manager);

  const timeoutId = setTimeout(() => {
    if (
      manager.nonStreamingRecorderGeneration !== recorderGeneration ||
      manager.mediaRecorder !== mediaRecorder ||
      !manager.isStopping
    ) {
      return;
    }

    manager.nonStreamingStopWatchdog = null;
    if (
      !retireNonStreamingRecorderWithoutEnqueue(manager, {
        mediaRecorder,
        stream,
        recorderGeneration,
      })
    ) {
      return;
    }

    const error = new Error("The microphone recorder did not confirm that it stopped in time.");
    error.code = "RECORDER_STOP_TIMEOUT";
    logger.error(
      "Non-streaming recorder stop timed out",
      {
        sessionId: context?.sessionId || null,
        jobId: context?.jobId ?? null,
        timeoutMs: NON_STREAMING_STOP_EVENT_TIMEOUT_MS,
      },
      "audio"
    );
    manager.emitError(
      {
        title: "Recording could not close",
        description: "That recording could not be finalized. Please dictate it again.",
        code: error.code,
        context,
      },
      error
    );
  }, NON_STREAMING_STOP_EVENT_TIMEOUT_MS);
  timeoutId.unref?.();
  manager.nonStreamingStopWatchdog = timeoutId;
}
