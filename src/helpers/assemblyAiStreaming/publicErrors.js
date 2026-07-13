const PUBLIC_STREAMING_MESSAGES = Object.freeze({
  AUTH_EXPIRED: "Session expired",
  NO_API: "Streaming is not configured",
  STREAMING_BACKPRESSURE: "The streaming connection could not keep up with microphone audio",
  STREAMING_CONNECTION_FAILED: "The streaming connection failed",
  STREAMING_PROVIDER_ERROR: "The streaming service reported an error",
  STREAMING_RESPONSE_INVALID: "The streaming service sent an invalid message",
  STREAMING_RESPONSE_LIMIT: "The streaming service sent an invalid or oversized message",
  STREAMING_SEND_FAILED: "The streaming connection stopped accepting microphone audio",
  STREAMING_SESSION_LIMIT: "The streaming session reached its safety limit",
  STREAMING_START_CANCELLED: "The streaming service could not be started",
  STREAMING_TOKEN_FAILED: "The streaming service could not be started",
  STREAMING_TOKEN_TIMEOUT: "The streaming service could not be started",
  STREAMING_TRANSCRIPT_LIMIT: "The streaming transcript exceeded its safety limit",
});

const getSafeErrorCode = (error, fallbackCode = "STREAMING_CONNECTION_FAILED") => {
  const code = typeof error?.code === "string" ? error.code : "";
  return Object.hasOwn(PUBLIC_STREAMING_MESSAGES, code) ? code : fallbackCode;
};

const toPublicStreamingError = (error, fallbackCode = "STREAMING_CONNECTION_FAILED") => {
  const code = getSafeErrorCode(error, fallbackCode);
  const publicError = new Error(PUBLIC_STREAMING_MESSAGES[code]);
  publicError.code = code;
  return publicError;
};

module.exports = {
  PUBLIC_STREAMING_MESSAGES,
  getSafeErrorCode,
  toPublicStreamingError,
};
