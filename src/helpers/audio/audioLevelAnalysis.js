const DB_FLOOR = -120;

export const LOW_AUDIO_MIN_DURATION_SECONDS = 2.5;
export const LOW_AUDIO_MAX_PEAK_DBFS = -40;
export const LOW_AUDIO_MAX_RMS_DBFS = -55;

function amplitudeToDbFS(amplitude) {
  if (!Number.isFinite(amplitude) || amplitude <= 0) {
    return DB_FLOOR;
  }
  return Math.max(DB_FLOOR, 20 * Math.log10(amplitude));
}

function roundDb(value) {
  return Number.isFinite(value) ? Number(value.toFixed(1)) : null;
}

export function summarizePcmAudioBuffer(audioBuffer) {
  const channelCount = audioBuffer?.numberOfChannels || 0;
  let peak = 0;
  let sumSquares = 0;
  let samples = 0;

  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const sample = data[i];
      const abs = Math.abs(sample);
      if (abs > peak) {
        peak = abs;
      }
      sumSquares += sample * sample;
      samples += 1;
    }
  }

  const rms = samples > 0 ? Math.sqrt(sumSquares / samples) : 0;
  const peakDbFS = amplitudeToDbFS(peak);
  const rmsDbFS = amplitudeToDbFS(rms);

  return {
    available: true,
    durationSeconds: audioBuffer?.duration ?? null,
    sampleRate: audioBuffer?.sampleRate ?? null,
    channelCount,
    peakDbFS: roundDb(peakDbFS),
    rmsDbFS: roundDb(rmsDbFS),
  };
}

export function getLowAudioRejection(audioLevel, metadata = {}) {
  if (!audioLevel?.available) {
    return null;
  }

  const durationSeconds =
    typeof metadata.durationSeconds === "number"
      ? metadata.durationSeconds
      : audioLevel.durationSeconds;

  if (
    typeof durationSeconds !== "number" ||
    durationSeconds < LOW_AUDIO_MIN_DURATION_SECONDS ||
    typeof audioLevel.peakDbFS !== "number" ||
    typeof audioLevel.rmsDbFS !== "number"
  ) {
    return null;
  }

  if (
    audioLevel.peakDbFS <= LOW_AUDIO_MAX_PEAK_DBFS &&
    audioLevel.rmsDbFS <= LOW_AUDIO_MAX_RMS_DBFS
  ) {
    return {
      code: "LOW_AUDIO_LEVEL",
      durationSeconds,
      peakDbFS: audioLevel.peakDbFS,
      rmsDbFS: audioLevel.rmsDbFS,
      message:
        "Selected microphone is too quiet or not receiving speech. Check the input device and microphone level, then try again.",
    };
  }

  return null;
}

export async function analyzeAudioBlobLevel(audioBlob) {
  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextCtor || !audioBlob?.arrayBuffer) {
    return { available: false, reason: "web-audio-unavailable" };
  }

  const audioContext = new AudioContextCtor();
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return summarizePcmAudioBuffer(decoded);
  } finally {
    try {
      await audioContext.close?.();
    } catch {
      // Ignore close failures; this is a best-effort diagnostic.
    }
  }
}
