const NON_STREAMING_STOP_FLUSH_MS = 60;

const sleep = (ms = 0) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const waitForNonStreamingStopFlush = async (manager, stopContext = null) => {
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

