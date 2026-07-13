import logger from "../../../utils/logger";

export async function saveDebugAudioCaptureIfEnabled(audioBlob, payload = {}) {
  try {
    const electronAPI = typeof window !== "undefined" ? window.electronAPI : null;
    if (!electronAPI?.getDebugState || !electronAPI?.debugSaveAudio) {
      return;
    }

    const debugState = await electronAPI.getDebugState().catch(() => null);
    if (!debugState?.enabled) {
      return;
    }

    const audioBuffer = await audioBlob.arrayBuffer();
    const result = await electronAPI.debugSaveAudio({
      audioBuffer,
      mimeType: audioBlob?.type || payload?.mimeType,
      ...payload,
    });

    if (result?.success) {
      logger.debug(
        "Debug audio capture saved",
        {
          bytes: result.bytes,
          kept: result.kept,
          deleted: result.deleted,
          bytesKept: result.bytesKept,
        },
        "audio"
      );
    } else if (result && result.skipped) {
      logger.debug("Debug audio capture skipped", { reason: result.reason }, "audio");
    } else if (result && result.error) {
      logger.debug("Debug audio capture failed", { error: result.error }, "audio");
    }
  } catch (error) {
    logger.debug("Debug audio capture failed", { error: error?.message || String(error) }, "audio");
  }
}
