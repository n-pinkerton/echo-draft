const WebSocket = require("ws");

const debugLogger = require("../debugLogger");
const {
  MAX_STREAMING_BUFFERED_BYTES,
  MAX_STREAMING_INBOUND_MESSAGE_BYTES,
  MAX_STREAMING_SESSION_AUDIO_BYTES,
  MAX_STREAMING_SESSION_MS,
  MAX_STREAMING_TRANSCRIPT_CHARS,
  MAX_STREAMING_TURN_CHARS,
  MAX_STREAMING_TURNS,
  TERMINATION_TIMEOUT_MS,
  WEBSOCKET_TIMEOUT_MS,
} = require("./constants");
const { buildAssemblyAiWebSocketUrl } = require("./urlBuilder");
const { applyEndOfTurnTranscript } = require("./turns");
const { getSafeErrorCode, toPublicStreamingError } = require("./publicErrors");
const {
  copyAudioStats,
  recordChunkDropped,
  recordChunkReceived,
  recordChunkSent,
} = require("./audioStats");

async function connectSession(self, options = {}) {
  const { token } = options;
  if (!token) {
    throw new Error("Streaming token is required");
  }

  if (self.isConnected) {
    debugLogger.debug("AssemblyAI streaming already connected");
    return { usedWarmConnection: false, alreadyConnected: true };
  }

  self.accumulatedText = "";
  self.lastTurnText = "";
  self.turns = [];
  self.resetAudioStats();
  self.sessionStartedAt = null;
  self.limitErrorRaised = false;

  if (self.hasWarmConnection()) {
    if (self.useWarmConnection()) {
      debugLogger.debug("AssemblyAI using warm connection - instant start");
      return { usedWarmConnection: true };
    }
  }

  const url = buildAssemblyAiWebSocketUrl(options);
  debugLogger.debug("AssemblyAI streaming connecting (cold start)");

  return new Promise((resolve, reject) => {
    self.pendingResolve = () => resolve({ usedWarmConnection: false });
    self.pendingReject = reject;

    self.connectionTimeout = setTimeout(() => {
      self.cleanup(new Error("AssemblyAI WebSocket connection timeout"));
    }, WEBSOCKET_TIMEOUT_MS);

    const WebSocketConstructor = self.WebSocketConstructor || WebSocket;
    self.ws = new WebSocketConstructor(url);

    self.ws.on("open", () => {
      debugLogger.debug("AssemblyAI WebSocket connected");
    });

    self.ws.on("message", (data) => {
      self.handleMessage(data);
    });

    self.ws.on("error", (error) => {
      const publicError = toPublicStreamingError(error);
      debugLogger.error("AssemblyAI WebSocket error", {
        errorCategory: getSafeErrorCode(error),
      });
      self.cleanup(publicError);
      self.onError?.(publicError);
    });

    self.ws.on("close", (code, reason) => {
      const wasActive = self.isConnected;
      debugLogger.debug("AssemblyAI WebSocket closed", {
        code,
        reasonBytes: reason?.byteLength || reason?.length || 0,
        wasActive,
      });
      const closeError = new Error(`AssemblyAI connection closed before completion (${code})`);
      self.cleanup(closeError);
      if (wasActive && !self.isDisconnecting) {
        self.onError?.(new Error(`Connection lost (code: ${code})`));
      }
    });
  });
}

function handleSessionMessage(self, data) {
  const inboundBytes =
    typeof data?.byteLength === "number"
      ? data.byteLength
      : Buffer.byteLength(String(data ?? ""), "utf8");
  if (inboundBytes < 1 || inboundBytes > MAX_STREAMING_INBOUND_MESSAGE_BYTES) {
    failStreamingSession(
      self,
      "The streaming service sent an invalid or oversized message",
      "STREAMING_RESPONSE_LIMIT"
    );
    return;
  }

  try {
    const message = JSON.parse(data.toString());
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new Error("Streaming message must be an object");
    }

    switch (message.type) {
      case "Begin":
        self.sessionId =
          typeof message.id === "string" && message.id.length <= 256 ? message.id : null;
        self.isConnected = true;
        self.sessionStartedAt = Date.now();
        clearTimeout(self.connectionTimeout);
        debugLogger.debug("AssemblyAI session started", { sessionId: self.sessionId });
        if (self.pendingResolve) {
          self.pendingResolve();
          self.pendingResolve = null;
          self.pendingReject = null;
        }
        break;

      case "Turn":
        if (typeof message.transcript === "string" && message.transcript) {
          if (
            message.transcript.length > MAX_STREAMING_TURN_CHARS ||
            self.turns.length >= MAX_STREAMING_TURNS
          ) {
            failStreamingSession(
              self,
              "The streaming transcript exceeded its safety limit",
              "STREAMING_TRANSCRIPT_LIMIT"
            );
            return;
          }
          if (message.end_of_turn) {
            const update = applyEndOfTurnTranscript(
              self.turns,
              message.transcript,
              Boolean(message.turn_is_formatted)
            );

            if (update.action === "added") {
              self.lastTurnText = update.lastTurnText;
              self.accumulatedText = update.accumulatedText;
              if (self.accumulatedText.length > MAX_STREAMING_TRANSCRIPT_CHARS) {
                failStreamingSession(
                  self,
                  "The streaming transcript exceeded its safety limit",
                  "STREAMING_TRANSCRIPT_LIMIT"
                );
                return;
              }
              self.onFinalTranscript?.(self.accumulatedText);
              debugLogger.debug("AssemblyAI final transcript (end_of_turn)", {
                turnLength: String(message.transcript).length,
                totalAccumulated: self.accumulatedText.length,
              });
            } else if (update.action === "replaced-previous") {
              self.lastTurnText = update.lastTurnText;
              self.accumulatedText = update.accumulatedText;
              if (self.accumulatedText.length > MAX_STREAMING_TRANSCRIPT_CHARS) {
                failStreamingSession(
                  self,
                  "The streaming transcript exceeded its safety limit",
                  "STREAMING_TRANSCRIPT_LIMIT"
                );
                return;
              }
              self.onFinalTranscript?.(self.accumulatedText);
              debugLogger.debug("AssemblyAI formatted turn update applied", {
                turnLength: update.lastTurnText.length,
                totalAccumulated: self.accumulatedText.length,
              });
            } else if (update.action === "ignored-duplicate") {
              debugLogger.debug("AssemblyAI duplicate turn ignored", {
                turnLength: String(message.transcript).length,
              });
            }
          } else {
            self.onPartialTranscript?.(message.transcript);
          }
        }
        break;

      case "Termination": {
        const audioStats = self.getAudioStats();
        debugLogger.debug("AssemblyAI session terminated", {
          audioDuration: message.audio_duration_seconds,
          audioStats,
        });
        if (self.terminationResolve) {
          self.terminationResolve({
            audioDuration: message.audio_duration_seconds,
            text: self.accumulatedText,
            audioStats,
            terminationConfirmed: true,
          });
          self.terminationResolve = null;
        }
        self.onSessionEnd?.({
          audioDuration: message.audio_duration_seconds,
          text: self.accumulatedText,
          audioStats,
          terminationConfirmed: true,
        });
        self.cleanup();
        break;
      }

      case "Error":
        debugLogger.error("AssemblyAI streaming service reported an error", {
          errorPresent: typeof message.error === "string" && message.error.length > 0,
        });
        failStreamingSession(
          self,
          "The streaming service reported an error",
          "STREAMING_PROVIDER_ERROR"
        );
        break;

      default:
        debugLogger.debug("AssemblyAI unknown message type", { type: message.type });
    }
  } catch (err) {
    debugLogger.error("AssemblyAI message parse error", { errorCategory: err?.name || "Error" });
    failStreamingSession(
      self,
      "The streaming service sent an invalid message",
      "STREAMING_RESPONSE_INVALID"
    );
  }
}

function failStreamingSession(self, message, code) {
  if (self.limitErrorRaised) return;
  self.limitErrorRaised = true;
  const error = new Error(message);
  error.code = code;
  cleanupSession(self, error);
  try {
    self.onError?.(error);
  } catch (callbackError) {
    debugLogger.error("AssemblyAI streaming error callback failed", {
      errorCategory: callbackError?.name || "Error",
    });
  }
}

function sendAudioChunk(self, pcmBuffer) {
  const byteLength =
    typeof pcmBuffer?.byteLength === "number"
      ? pcmBuffer.byteLength
      : typeof pcmBuffer?.length === "number"
        ? pcmBuffer.length
        : 0;

  const now = Date.now();
  recordChunkReceived(self.audioStats, byteLength, now);

  if (
    self.audioStats.bytesReceived > MAX_STREAMING_SESSION_AUDIO_BYTES ||
    (self.sessionStartedAt && now - self.sessionStartedAt > MAX_STREAMING_SESSION_MS)
  ) {
    recordChunkDropped(self.audioStats, now);
    failStreamingSession(
      self,
      "The streaming session reached its safety limit",
      "STREAMING_SESSION_LIMIT"
    );
    return false;
  }

  if (!self.ws || self.ws.readyState !== WebSocket.OPEN) {
    recordChunkDropped(self.audioStats, now);
    return false;
  }

  if (Number(self.ws.bufferedAmount || 0) > MAX_STREAMING_BUFFERED_BYTES) {
    recordChunkDropped(self.audioStats, now);
    failStreamingSession(
      self,
      "The streaming connection could not keep up with microphone audio",
      "STREAMING_BACKPRESSURE"
    );
    return false;
  }

  try {
    self.ws.send(pcmBuffer);
  } catch (error) {
    recordChunkDropped(self.audioStats, now);
    failStreamingSession(
      self,
      "The streaming connection stopped accepting microphone audio",
      "STREAMING_SEND_FAILED"
    );
    return false;
  }
  recordChunkSent(self.audioStats, byteLength, self.ws.bufferedAmount, now);
  return true;
}

function forceEndpoint(self) {
  if (!self.ws || self.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  self.ws.send(JSON.stringify({ type: "ForceEndpoint" }));
  debugLogger.debug("AssemblyAI ForceEndpoint sent");
  return true;
}

async function disconnectSession(self, terminate = true) {
  const buildUnconfirmedResult = (extra = {}) => ({
    text: self.accumulatedText,
    audioStats: self.getAudioStats(),
    terminationConfirmed: false,
    ...extra,
  });

  if (!self.ws) {
    return buildUnconfirmedResult({ terminationUnavailable: true });
  }

  self.isDisconnecting = true;

  if (terminate && self.ws.readyState === WebSocket.OPEN) {
    try {
      let timeoutId;
      const result = await new Promise((resolve) => {
        self.terminationResolve = resolve;
        timeoutId = setTimeout(() => {
          self.terminationResolve = null;
          debugLogger.debug("AssemblyAI termination timeout; accumulated text is unconfirmed");
          resolve(buildUnconfirmedResult({ terminationTimedOut: true }));
        }, TERMINATION_TIMEOUT_MS);

        try {
          self.ws.send(JSON.stringify({ type: "Terminate" }));
        } catch (error) {
          clearTimeout(timeoutId);
          self.terminationResolve = null;
          debugLogger.debug("AssemblyAI terminate send failed", {
            errorCategory: error?.name || "Error",
          });
          resolve(buildUnconfirmedResult({ terminationUnavailable: true }));
        }
      });
      clearTimeout(timeoutId);

      self.terminationResolve = null;
      self.cleanup();
      self.isDisconnecting = false;
      return result;
    } catch (err) {
      debugLogger.debug("AssemblyAI terminate failed", { error: err.message });
    }
  }

  const result = buildUnconfirmedResult({ terminationUnavailable: terminate });
  self.cleanup();
  self.isDisconnecting = false;
  return result;
}

function cleanupSession(self, pendingError = null) {
  const pendingReject = self.pendingReject;
  const terminationResolve = self.terminationResolve;
  clearTimeout(self.connectionTimeout);
  self.connectionTimeout = null;

  if (self.ws) {
    const socket = self.ws;
    self.ws = null;
    try {
      socket.removeAllListeners?.();
      socket.close();
    } catch {
      // Ignore close errors
    }
  }

  self.isConnected = false;
  self.sessionId = null;
  self.pendingResolve = null;
  self.pendingReject = null;
  self.terminationResolve = null;
  self.sessionStartedAt = null;

  if (pendingReject) {
    pendingReject(pendingError || new Error("AssemblyAI connection setup was interrupted"));
  }
  if (terminationResolve) {
    terminationResolve({
      text: self.accumulatedText,
      audioStats: self.getAudioStats(),
      terminationConfirmed: false,
      terminationUnavailable: true,
    });
  }
}

function cleanupAll(self) {
  cleanupSession(self);
  self.cachedToken = null;
  self.tokenFetchedAt = null;
  self.turns = [];
}

function getStatus(self) {
  return {
    isConnected: self.isConnected,
    sessionId: self.sessionId,
    hasWarmConnection: self.hasWarmConnection(),
    hasValidToken: self.isTokenValid(),
  };
}

function getAudioStats(self) {
  return copyAudioStats(self.audioStats);
}

module.exports = {
  cleanupAll,
  cleanupSession,
  connectSession,
  disconnectSession,
  forceEndpoint,
  getAudioStats,
  getStatus,
  handleSessionMessage,
  sendAudioChunk,
};
