import { isBuiltInMicrophone } from "../../../utils/audioDeviceUtils";

const NO_AUDIO_PROCESSING_CONSTRAINTS = {
  // Disable browser audio processing — dictation doesn't need it and it adds latency.
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * Microphone selection + warmup helpers used by AudioManager and streaming recording.
 *
 * This class intentionally:
 * - keeps all mic/permission/warmup state in one place
 * - keeps AudioManager as an orchestrator instead of a god-object
 */
export class MicrophoneService {
  /**
   * @param {{
   *   logger: any,
   *   isBuiltInMicrophoneFn?: (label: string) => boolean,
   * }} deps
   */
  constructor(deps = {}) {
    this.logger = deps.logger;
    this.isBuiltInMicrophoneFn = deps.isBuiltInMicrophoneFn || isBuiltInMicrophone;

    this.cachedMicDeviceId = null;
    this.micWarmupPromise = null;
    this.micDriverWarmedUp = false;
  }

  async getAudioConstraints() {
    const preferBuiltIn =
      typeof localStorage !== "undefined" ? localStorage.getItem("preferBuiltInMic") !== "false" : true;
    const selectedDeviceId =
      typeof localStorage !== "undefined" ? localStorage.getItem("selectedMicDeviceId") || "" : "";

    if (preferBuiltIn) {
      if (this.cachedMicDeviceId) {
        this.logger?.debug?.(
          "Using cached microphone device ID",
          { deviceId: this.cachedMicDeviceId },
          "audio"
        );
        return {
          audio: { deviceId: { exact: this.cachedMicDeviceId }, ...NO_AUDIO_PROCESSING_CONSTRAINTS },
        };
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((d) => d.kind === "audioinput");
        const builtInMic = audioInputs.find((d) => this.isBuiltInMicrophoneFn(d.label));

        if (builtInMic) {
          this.cachedMicDeviceId = builtInMic.deviceId;
          this.logger?.debug?.(
            "Using built-in microphone (cached for next time)",
            { deviceId: builtInMic.deviceId, label: builtInMic.label },
            "audio"
          );
          return {
            audio: { deviceId: { exact: builtInMic.deviceId }, ...NO_AUDIO_PROCESSING_CONSTRAINTS },
          };
        }
      } catch (error) {
        this.logger?.debug?.(
          "Failed to enumerate devices for built-in mic detection",
          { error: error?.message || String(error) },
          "audio"
        );
      }
    }

    if (!preferBuiltIn && selectedDeviceId) {
      this.logger?.debug?.("Using selected microphone", { deviceId: selectedDeviceId }, "audio");
      return { audio: { deviceId: { exact: selectedDeviceId }, ...NO_AUDIO_PROCESSING_CONSTRAINTS } };
    }

    this.logger?.debug?.("Using default microphone", {}, "audio");
    return { audio: NO_AUDIO_PROCESSING_CONSTRAINTS };
  }

  async cacheMicrophoneDeviceId() {
    if (this.cachedMicDeviceId) return;

    const preferBuiltIn =
      typeof localStorage !== "undefined" ? localStorage.getItem("preferBuiltInMic") !== "false" : true;
    if (!preferBuiltIn) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      const builtInMic = audioInputs.find((d) => this.isBuiltInMicrophoneFn(d.label));
      if (builtInMic) {
        this.cachedMicDeviceId = builtInMic.deviceId;
        this.logger?.debug?.(
          "Microphone device ID pre-cached",
          { deviceId: builtInMic.deviceId },
          "audio"
        );
      }
    } catch (error) {
      this.logger?.debug?.(
        "Failed to pre-cache microphone device ID",
        { error: error?.message || String(error) },
        "audio"
      );
    }
  }

  async getMicrophonePermissionState() {
    try {
      const permissions = navigator?.permissions;
      if (!permissions?.query) {
        return null;
      }
      const status = await permissions.query({ name: "microphone" });
      return status?.state ?? null;
    } catch {
      return null;
    }
  }

  async warmupMicrophoneDriver() {
    if (this.micDriverWarmedUp) {
      return true;
    }

    if (this.micWarmupPromise) {
      return await this.micWarmupPromise;
    }

    this.micWarmupPromise = (async () => {
      const permissionState = await this.getMicrophonePermissionState();
      const persistedGrant =
        typeof localStorage !== "undefined" && localStorage?.getItem?.("micPermissionGranted") === "true";

      if (permissionState === "granted") {
        // ok
      } else if (!permissionState && persistedGrant) {
        // Permissions API may not be available, but the app has successfully used the mic before.
      } else {
        this.logger?.debug?.(
          "Mic driver warmup skipped - permission not granted",
          { permissionState, persistedGrant },
          "audio"
        );
        return false;
      }

      try {
        await this.cacheMicrophoneDeviceId();
        const constraints = await this.getAudioConstraints();
        const tempStream = await navigator.mediaDevices.getUserMedia(constraints);
        tempStream.getTracks().forEach((track) => track.stop());
        this.micDriverWarmedUp = true;
        try {
          localStorage?.setItem?.("micPermissionGranted", "true");
        } catch {
          // Ignore persistence errors
        }
        this.logger?.debug?.("Microphone driver pre-warmed", { permissionState }, "audio");
        return true;
      } catch (error) {
        this.logger?.debug?.(
          "Mic driver warmup failed (non-critical)",
          { error: error?.message || String(error) },
          "audio"
        );
        return false;
      }
    })().finally(() => {
      this.micWarmupPromise = null;
    });

    return await this.micWarmupPromise;
  }
}

