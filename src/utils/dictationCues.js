import logger from "./logger";

export const DICTATION_FEEDBACK_STORAGE_KEYS = Object.freeze({
  soundsEnabled: "dictationSoundsEnabled",
  soundVolume: "dictationSoundVolume",
  recordingIndicatorEnabled: "recordingIndicatorEnabled",
  longRecordingReminderEnabled: "longRecordingReminderEnabled",
});

export const DEFAULT_DICTATION_SOUND_VOLUME = 65;

const MIN_GAIN = 0.0001;
const MASTER_GAIN = 0.22;
const DEFAULT_ATTACK_SECONDS = 0.008;

let audioContext = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getAudioContext = () => {
  if (typeof window === "undefined") {
    return null;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContextCtor();
  }

  return audioContext;
};

const readSoundsEnabled = () => {
  try {
    return window.localStorage?.getItem(DICTATION_FEEDBACK_STORAGE_KEYS.soundsEnabled) !== "false";
  } catch {
    return true;
  }
};

const readSoundVolume = () => {
  try {
    const rawStoredValue = window.localStorage?.getItem(
      DICTATION_FEEDBACK_STORAGE_KEYS.soundVolume
    );
    if (rawStoredValue === null || rawStoredValue === "") {
      return DEFAULT_DICTATION_SOUND_VOLUME;
    }

    const storedValue = Number(rawStoredValue);
    return Number.isFinite(storedValue)
      ? clamp(storedValue, 0, 100)
      : DEFAULT_DICTATION_SOUND_VOLUME;
  } catch {
    return DEFAULT_DICTATION_SOUND_VOLUME;
  }
};

const resolvePlaybackVolume = (options = {}) => {
  if (!options.force && !readSoundsEnabled()) {
    return null;
  }

  const requestedVolume = Number(options.volume);
  const volumePercent = Number.isFinite(requestedVolume) ? requestedVolume : readSoundVolume();
  return clamp(volumePercent, 0, 100) / 100;
};

export const resumeContextIfNeeded = async () => {
  try {
    const context = getAudioContext();
    if (!context) {
      return null;
    }

    if (context.state === "suspended") {
      await context.resume();
    }

    return context.state === "running" ? context : null;
  } catch (error) {
    logger.debug(
      "Failed to initialize dictation cue audio context",
      { error: error instanceof Error ? error.message : String(error) },
      "audio"
    );
    return null;
  }
};

const scheduleTone = (
  context,
  {
    frequency,
    endFrequency = null,
    startTime,
    durationSeconds,
    type = "sine",
    gainScale = 1,
    attackSeconds = DEFAULT_ATTACK_SECONDS,
  }
) => {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const stopTime = startTime + durationSeconds;
  const peakGain = Math.max(MIN_GAIN, MASTER_GAIN * gainScale);

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  if (Number.isFinite(endFrequency) && endFrequency > 0) {
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, stopTime);
  }

  gainNode.gain.setValueAtTime(MIN_GAIN, startTime);
  gainNode.gain.linearRampToValueAtTime(peakGain, Math.min(stopTime, startTime + attackSeconds));
  gainNode.gain.exponentialRampToValueAtTime(MIN_GAIN, stopTime);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start(startTime);
  oscillator.stop(stopTime + 0.01);
};

const playCue = async (schedule, options = {}) => {
  try {
    const volume = resolvePlaybackVolume(options);
    if (volume === null || volume === 0) {
      return;
    }

    const context = await resumeContextIfNeeded();
    if (!context) {
      return;
    }

    schedule(context, context.currentTime + 0.005, volume);
  } catch (error) {
    logger.debug(
      "Failed to play dictation cue",
      { error: error instanceof Error ? error.message : String(error) },
      "audio"
    );
  }
};

// Bright, discrete, and rising: the microphone is now open.
export const playStartCue = (options) =>
  playCue((context, baseTime, volume) => {
    scheduleTone(context, {
      frequency: 440,
      startTime: baseTime,
      durationSeconds: 0.085,
      type: "triangle",
      gainScale: 0.72 * volume,
    });
    scheduleTone(context, {
      frequency: 659.25,
      startTime: baseTime + 0.115,
      durationSeconds: 0.105,
      type: "triangle",
      gainScale: 0.9 * volume,
    });
  }, options);

// Lower, continuous, and falling with a muted endpoint: recording is closed and processing began.
export const playStopCue = (options) =>
  playCue((context, baseTime, volume) => {
    scheduleTone(context, {
      frequency: 783.99,
      endFrequency: 261.63,
      startTime: baseTime,
      durationSeconds: 0.26,
      type: "sine",
      gainScale: 0.72 * volume,
      attackSeconds: 0.012,
    });
    scheduleTone(context, {
      frequency: 174.61,
      startTime: baseTime + 0.245,
      durationSeconds: 0.07,
      type: "triangle",
      gainScale: 0.48 * volume,
      attackSeconds: 0.003,
    });
  }, options);

// Harmonic then tactile, with no directional contour: the requested text delivery succeeded.
export const playCompletionCue = (options) =>
  playCue((context, baseTime, volume) => {
    [
      { frequency: 523.25, gainScale: 0.32 },
      { frequency: 659.25, gainScale: 0.27 },
      { frequency: 783.99, gainScale: 0.22 },
    ].forEach(({ frequency, gainScale }) => {
      scheduleTone(context, {
        frequency,
        startTime: baseTime,
        durationSeconds: 0.34,
        type: "sine",
        gainScale: gainScale * volume,
        attackSeconds: 0.015,
      });
    });
    scheduleTone(context, {
      frequency: 196,
      startTime: baseTime + 0.22,
      durationSeconds: 0.065,
      type: "triangle",
      gainScale: 0.42 * volume,
      attackSeconds: 0.003,
    });
  }, options);

// Two low dry pulses: the requested action did not complete.
export const playErrorCue = (options) =>
  playCue((context, baseTime, volume) => {
    [220, 196].forEach((frequency, index) => {
      scheduleTone(context, {
        frequency,
        startTime: baseTime + index * 0.145,
        durationSeconds: 0.085,
        type: "triangle",
        gainScale: 0.58 * volume,
        attackSeconds: 0.003,
      });
    });
  }, options);

// One neutral muted tap: the operation was intentionally cancelled.
export const playCancelCue = (options) =>
  playCue((context, baseTime, volume) => {
    scheduleTone(context, {
      frequency: 261.63,
      startTime: baseTime,
      durationSeconds: 0.08,
      type: "triangle",
      gainScale: 0.42 * volume,
      attackSeconds: 0.003,
    });
  }, options);
