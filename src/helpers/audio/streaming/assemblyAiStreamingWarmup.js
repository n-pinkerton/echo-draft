import logger from "../../../utils/logger";
import { getBaseLanguageCode } from "../../../utils/languageSupport";
import { getOrCreateAudioContext } from "./streamingAudioContext";

export async function warmupStreamingConnection(manager) {
  // Always pre-warm the microphone when possible (helps reduce hotkey → recording latency,
  // even for non-streaming modes like local whisper or BYOK providers).
  manager.warmupMicrophoneDriver().catch(() => {});

  if (!manager.shouldUseStreaming()) {
    logger.debug("Streaming warmup skipped - not in streaming mode", {}, "streaming");
    return false;
  }

  try {
    const [, wsResult] = await Promise.all([
      manager.cacheMicrophoneDeviceId(),
      manager.withSessionRefresh(async () => {
        const res = await window.electronAPI.assemblyAiStreamingWarmup({
          sampleRate: 16000,
          language: getBaseLanguageCode(localStorage.getItem("preferredLanguage")),
        });
        // Throw error to trigger retry if AUTH_EXPIRED
        if (!res.success && res.code) {
          const err = new Error(res.error || "Warmup failed");
          err.code = res.code;
          throw err;
        }
        return res;
      }),
    ]);

    if (wsResult.success) {
      // Pre-load AudioWorklet module so first recording is faster
      try {
        const audioContext = await getOrCreateAudioContext(manager);
        if (!manager.workletModuleLoaded) {
          await audioContext.audioWorklet.addModule(manager.streamingWorklet.getWorkletBlobUrl());
          manager.workletModuleLoaded = true;
          logger.debug("AudioWorklet module pre-loaded during warmup", {}, "streaming");
        }
      } catch (e) {
        logger.debug(
          "AudioWorklet pre-load failed (will retry on recording)",
          { error: e.message },
          "streaming"
        );
      }

      logger.info(
        "AssemblyAI streaming connection warmed up",
        { alreadyWarm: wsResult.alreadyWarm, micCached: !!manager.cachedMicDeviceId },
        "streaming"
      );
      return true;
    }

    if (wsResult.code === "NO_API") {
      logger.debug("Streaming warmup skipped - API not configured", {}, "streaming");
      return false;
    }

    logger.warn("AssemblyAI warmup failed", { error: wsResult.error }, "streaming");
    return false;
  } catch (error) {
    logger.error("AssemblyAI warmup error", { error: error.message }, "streaming");
    return false;
  }
}

