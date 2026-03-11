import logger from "./logger";

const START_NOTES = [1046.5];
const STOP_NOTES = [698.46];
const COMPLETION_NOTES = [1046.5, 880, 698.46];
const START_STOP_NOTE_DURATION_SECONDS = 0.035;
const COMPLETION_NOTE_DURATION_SECONDS = 0.06;
const NOTE_GAP_SECONDS = 0.02;
const NOTE_ATTACK_SECONDS = 0.004;
const MAX_GAIN = 0.2;
const MIN_GAIN = 0.0001;

let audioContext = null;

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

const scheduleTone = (context, frequency, startTime, durationSeconds) => {
  const oscillator = context.createOscillator();
  const gainNode = context.createGain();
  const stopTime = startTime + durationSeconds;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gainNode.gain.setValueAtTime(MIN_GAIN, startTime);
  gainNode.gain.linearRampToValueAtTime(MAX_GAIN, startTime + NOTE_ATTACK_SECONDS);
  gainNode.gain.exponentialRampToValueAtTime(MIN_GAIN, stopTime);

  oscillator.connect(gainNode);
  gainNode.connect(context.destination);

  oscillator.start(startTime);
  oscillator.stop(stopTime + 0.01);
};

const playCue = async (notes, durationSeconds) => {
  try {
    const context = await resumeContextIfNeeded();
    if (!context) {
      return;
    }

    const baseTime = context.currentTime + 0.005;
    notes.forEach((frequency, index) => {
      const noteStart = baseTime + index * (durationSeconds + NOTE_GAP_SECONDS);
      scheduleTone(context, frequency, noteStart, durationSeconds);
    });
  } catch (error) {
    logger.debug(
      "Failed to play dictation cue",
      { error: error instanceof Error ? error.message : String(error) },
      "audio"
    );
  }
};

export const playStartCue = () => playCue(START_NOTES, START_STOP_NOTE_DURATION_SECONDS);

export const playStopCue = () => playCue(STOP_NOTES, START_STOP_NOTE_DURATION_SECONDS);

export const playCompletionCue = () => playCue(COMPLETION_NOTES, COMPLETION_NOTE_DURATION_SECONDS);
