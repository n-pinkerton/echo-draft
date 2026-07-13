export const formatRecordingDuration = (ms = 0) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const LONG_RECORDING_REMINDER_MS = 60_000;

export const shouldShowLongRecordingReminder = (recordedMs = 0, reminderEnabled = true) =>
  reminderEnabled && recordedMs >= LONG_RECORDING_REMINDER_MS;
