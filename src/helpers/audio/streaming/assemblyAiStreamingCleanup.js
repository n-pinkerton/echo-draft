export function cleanupStreamingAudio(manager) {
  manager.streamingAudioForwarding = false;
  manager.streamingWorklet.resolveFlushWaiter();

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

  manager.isStreaming = false;
}

export function cleanupStreamingListeners(manager) {
  for (const cleanup of manager.streamingCleanupFns) {
    try {
      cleanup?.();
    } catch {
      // Ignore cleanup errors
    }
  }
  manager.streamingCleanupFns = [];
  manager.streamingFinalText = "";
  manager.streamingPartialText = "";
  manager.streamingTextResolve = null;
  clearTimeout(manager.streamingTextDebounce);
  manager.streamingTextDebounce = null;
}

export async function cleanupStreaming(manager) {
  cleanupStreamingAudio(manager);
  cleanupStreamingListeners(manager);
}

