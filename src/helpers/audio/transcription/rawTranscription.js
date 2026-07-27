/**
 * The transcription-stage result is a separate value from cleanup output.
 * Keep the snapshot object frozen so cleanup code cannot replace the value that
 * persistence receives as rawText.
 */
export const captureRawTranscription = (text) => {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Raw transcription is required");
  }
  return Object.freeze({ text });
};

export const createTranscriptionPersistencePayload = ({ text, rawText, meta } = {}) => {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Cleaned transcription is required");
  }
  const rawSnapshot = captureRawTranscription(rawText);
  return {
    text,
    rawText: rawSnapshot.text,
    ...(meta && typeof meta === "object" ? { meta } : {}),
  };
};
