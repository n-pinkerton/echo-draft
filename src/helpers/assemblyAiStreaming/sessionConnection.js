const WebSocket = require("ws");

const debugLogger = require("../debugLogger");
const { TERMINATION_TIMEOUT_MS, WEBSOCKET_TIMEOUT_MS } = require("./constants");
const { buildAssemblyAiWebSocketUrl } = require("./urlBuilder");
const { applyEndOfTurnTranscript } = require("./turns");
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
    return;
  }

  self.accumulatedText = "";
  self.lastTurnText = "";
  self.turns = [];
  self.resetAudioStats();

  if (self.hasWarmConnection()) {
    if (self.useWarmConnection()) {
      debugLogger.debug("AssemblyAI using warm connection - instant start");
      return;
    }
  }

  const url = buildAssemblyAiWebSocketUrl(options);
  debugLogger.debug("AssemblyAI streaming connecting (cold start)");

  return new Promise((resolve, reject) => {
    self.pendingResolve = resolve;
    self.pendingReject = reject;

    self.connectionTimeout = setTimeout(() => {
      self.cleanup();
      reject(new Error("AssemblyAI WebSocket connection timeout"));
    }, WEBSOCKET_TIMEOUT_MS);

    self.ws = new WebSocket(url);

    self.ws.on("open", () => {
      debugLogger.debug("AssemblyAI WebSocket connected");
    });

    self.ws.on("message", (data) => {
      self.handleMessage(data);
    });

    self.ws.on("error", (error) => {
      debugLogger.error("AssemblyAI WebSocket error", { error: error.message });
      self.cleanup();
      if (self.pendingReject) {
        self.pendingReject(error);
        self.pendingReject = null;
        self.pendingResolve = null;
      }
      self.onError?.(error);
    });

    self.ws.on("close", (code, reason) => {
      const wasActive = self.isConnected;
      debugLogger.debug("AssemblyAI WebSocket closed", {
        code,
        reason: reason?.toString(),
        wasActive,
      });
      self.cleanup();
      if (wasActive && !self.isDisconnecting) {
        self.onError?.(new Error(`Connection lost (code: ${code})`));
      }
    });
  });
}

function handleSessionMessage(self, data) {
  try {
    const message = JSON.parse(data.toString());

    switch (message.type) {
      case "Begin":
        self.sessionId = message.id;
        self.isConnected = true;
        clearTimeout(self.connectionTimeout);
        debugLogger.debug("AssemblyAI session started", { sessionId: self.sessionId });
        if (self.pendingResolve) {
          self.pendingResolve();
          self.pendingResolve = null;
          self.pendingReject = null;
        }
        break;

      case "Turn":
        if (message.transcript) {
          if (message.end_of_turn) {
            const update = applyEndOfTurnTranscript(
              self.turns,
              message.transcript,
              Boolean(message.turn_is_formatted)
            );

            if (update.action === "added") {
              self.lastTurnText = update.lastTurnText;
              self.accumulatedText = update.accumulatedText;
              self.onFinalTranscript?.(self.accumulatedText);
              debugLogger.debug("AssemblyAI final transcript (end_of_turn)", {
                turnLength: String(message.transcript).length,
                totalAccumulated: self.accumulatedText.length,
              });
            } else if (update.action === "replaced-previous") {
              self.lastTurnText = update.lastTurnText;
              self.accumulatedText = update.accumulatedText;
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
        debugLogger.error("AssemblyAI streaming error", { error: message.error });
        self.onError?.(new Error(message.error));
        break;

      default:
        debugLogger.debug("AssemblyAI unknown message type", { type: message.type });
    }
  } catch (err) {
    debugLogger.error("AssemblyAI message parse error", { error: err.message });
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

  if (!self.ws || self.ws.readyState !== WebSocket.OPEN) {
    recordChunkDropped(self.audioStats, now);
    return false;
  }

  self.ws.send(pcmBuffer);
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
          debugLogger.debug("AssemblyAI terminate send failed", { error: error.message });
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

function cleanupSession(self) {
  clearTimeout(self.connectionTimeout);
  self.connectionTimeout = null;

  if (self.ws) {
    try {
      self.ws.close();
    } catch {
      // Ignore close errors
    }
    self.ws = null;
  }

  self.isConnected = false;
  self.sessionId = null;
  self.pendingResolve = null;
  self.pendingReject = null;
  self.terminationResolve = null;
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
