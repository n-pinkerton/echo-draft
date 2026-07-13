export const TRANSCRIPTION_CANCELLED_CODE = "TRANSCRIPTION_CANCELLED";

export const createTranscriptionCancelledError = () => {
  const error = new Error("Transcription cancelled");
  error.name = "AbortError";
  error.code = TRANSCRIPTION_CANCELLED_CODE;
  error.cancelled = true;
  return error;
};

export const isTranscriptionCancelled = (error, signal = null) =>
  signal?.aborted === true ||
  error?.cancelled === true ||
  error?.code === TRANSCRIPTION_CANCELLED_CODE;

export const throwIfTranscriptionCancelled = (signal) => {
  if (signal?.aborted) {
    throw createTranscriptionCancelledError();
  }
};
