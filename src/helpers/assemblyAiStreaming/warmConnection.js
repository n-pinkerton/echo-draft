const WebSocket = require("ws");

const debugLogger = require("../debugLogger");
const {
  KEEPALIVE_INTERVAL_MS,
  MAX_STREAMING_INBOUND_MESSAGE_BYTES,
  MAX_REWARM_ATTEMPTS,
  REWARM_DELAY_MS,
  WEBSOCKET_TIMEOUT_MS,
} = require("./constants");
const { buildAssemblyAiWebSocketUrl } = require("./urlBuilder");
const { getSafeErrorCode, toPublicStreamingError } = require("./publicErrors");

function stopKeepAlive(self) {
  if (self.keepAliveInterval) {
    clearInterval(self.keepAliveInterval);
    self.keepAliveInterval = null;
  }
}

function startKeepAlive(self) {
  stopKeepAlive(self);

  self.keepAliveInterval = setInterval(() => {
    if (self.warmConnection && self.warmConnection.readyState === WebSocket.OPEN) {
      try {
        self.warmConnection.ping();
      } catch (err) {
        debugLogger.debug("AssemblyAI keep-alive ping failed", { error: err.message });
        cleanupWarmConnection(self);
      }
    } else {
      stopKeepAlive(self);
    }
  }, KEEPALIVE_INTERVAL_MS);
}

function cleanupWarmConnection(self) {
  stopKeepAlive(self);

  if (self.warmConnection) {
    try {
      self.warmConnection.close();
    } catch {
      // Ignore
    }
    self.warmConnection = null;
  }

  self.warmConnectionReady = false;
  self.warmConnectionOptions = null;
  self.warmSessionId = null;
}

function hasWarmConnection(self) {
  return (
    self.warmConnection !== null &&
    self.warmConnectionReady &&
    self.warmConnection.readyState === WebSocket.OPEN
  );
}

function scheduleRewarm(self) {
  if (self.rewarmAttempts >= MAX_REWARM_ATTEMPTS) {
    debugLogger.debug("AssemblyAI max re-warm attempts reached, will cold-start next recording");
    return;
  }

  if (self.isConnected) {
    return;
  }

  const token = self.getCachedToken();
  if (!token || !self.warmConnectionOptions) {
    debugLogger.debug("AssemblyAI cannot re-warm: no valid token or options");
    return;
  }

  self.rewarmAttempts += 1;
  const delay = Math.min(REWARM_DELAY_MS * Math.pow(2, self.rewarmAttempts - 1), 60000);
  debugLogger.debug("AssemblyAI scheduling re-warm", {
    attempt: self.rewarmAttempts,
    delayMs: delay,
  });

  clearTimeout(self.rewarmTimer);
  self.rewarmTimer = setTimeout(() => {
    self.rewarmTimer = null;
    if (hasWarmConnection(self) || self.isConnected) return;
    warmupConnection(self, { ...self.warmConnectionOptions, token }).catch((err) => {
      debugLogger.debug("AssemblyAI auto re-warm failed", { error: err.message });
    });
  }, delay);
}

function useWarmConnection(self) {
  if (!self.warmConnection || !self.warmConnectionReady) {
    return false;
  }

  if (self.warmConnection.readyState !== WebSocket.OPEN) {
    debugLogger.debug("AssemblyAI warm connection readyState not OPEN, discarding", {
      readyState: self.warmConnection.readyState,
    });
    cleanupWarmConnection(self);
    return false;
  }

  stopKeepAlive(self);

  self.ws = self.warmConnection;
  self.isConnected = true;
  self.sessionStartedAt = Date.now();
  self.limitErrorRaised = false;
  self.sessionId = self.warmSessionId || null;
  self.warmConnection = null;
  self.warmConnectionReady = false;
  self.warmSessionId = null;

  self.ws.removeAllListeners("message");
  self.ws.on("message", (data) => {
    self.handleMessage(data);
  });

  self.ws.removeAllListeners("error");
  self.ws.on("error", (error) => {
    const publicError = toPublicStreamingError(error);
    debugLogger.error("AssemblyAI WebSocket error", {
      errorCategory: getSafeErrorCode(error),
    });
    self.cleanup();
    self.onError?.(publicError);
  });

  self.ws.removeAllListeners("close");
  self.ws.on("close", (code, reason) => {
    const wasActive = self.isConnected;
    debugLogger.debug("AssemblyAI WebSocket closed", {
      code,
      reasonBytes: reason?.byteLength || reason?.length || 0,
      wasActive,
    });
    self.cleanup();
    if (wasActive && !self.isDisconnecting) {
      self.onError?.(new Error(`Connection lost (code: ${code})`));
    }
  });

  debugLogger.debug("AssemblyAI using pre-warmed connection");
  return true;
}

async function warmupConnection(self, options = {}) {
  const { token } = options;
  if (!token) {
    throw new Error("Streaming token is required for warmup");
  }

  if (self.warmConnection) {
    debugLogger.debug(
      self.warmConnectionReady
        ? "AssemblyAI connection already warm"
        : "AssemblyAI warmup already in progress, skipping"
    );
    return;
  }

  self.warmConnectionReady = false;
  self.warmSessionId = null;
  self.cacheToken(token);
  self.warmConnectionOptions = options;
  self.rewarmAttempts = 0;

  const url = buildAssemblyAiWebSocketUrl(options);
  debugLogger.debug("AssemblyAI warming up connection");

  return new Promise((resolve, reject) => {
    let settled = false;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const warmupTimeout = setTimeout(() => {
      cleanupWarmConnection(self);
      settleReject(new Error("AssemblyAI warmup connection timeout"));
    }, WEBSOCKET_TIMEOUT_MS);

    const WebSocketConstructor = self.WebSocketConstructor || WebSocket;
    self.warmConnection = new WebSocketConstructor(url);

    self.warmConnection.on("open", () => {
      debugLogger.debug("AssemblyAI warm connection socket opened");
    });

    self.warmConnection.on("message", (data) => {
      try {
        const byteLength =
          typeof data?.byteLength === "number"
            ? data.byteLength
            : Buffer.byteLength(String(data ?? ""), "utf8");
        if (byteLength < 1 || byteLength > MAX_STREAMING_INBOUND_MESSAGE_BYTES) {
          throw new Error("AssemblyAI warmup response exceeded the size limit");
        }
        const message = JSON.parse(data.toString());
        if (message.type === "Begin") {
          clearTimeout(warmupTimeout);
          self.warmConnectionReady = true;
          self.warmSessionId = message.id || null;
          startKeepAlive(self);
          debugLogger.debug("AssemblyAI connection warmed up", { sessionId: message.id });
          settleResolve();
        } else if (message.type === "Error") {
          clearTimeout(warmupTimeout);
          debugLogger.error("AssemblyAI warmup service reported an error", {
            errorPresent: typeof message.error === "string" && message.error.length > 0,
          });
          const publicError = toPublicStreamingError(
            { code: "STREAMING_PROVIDER_ERROR" },
            "STREAMING_PROVIDER_ERROR"
          );
          cleanupWarmConnection(self);
          settleReject(publicError);
        }
      } catch (err) {
        debugLogger.error("AssemblyAI warmup message parse error", {
          errorCategory: err?.name || "Error",
        });
        clearTimeout(warmupTimeout);
        cleanupWarmConnection(self);
        settleReject(new Error("AssemblyAI warmup returned an invalid response"));
      }
    });

    self.warmConnection.on("error", (error) => {
      clearTimeout(warmupTimeout);
      debugLogger.error("AssemblyAI warmup connection error", {
        errorCategory: getSafeErrorCode(error),
      });
      cleanupWarmConnection(self);
      settleReject(toPublicStreamingError(error));
    });

    self.warmConnection.on("close", (code, reason) => {
      clearTimeout(warmupTimeout);
      stopKeepAlive(self);
      const wasReady = self.warmConnectionReady;
      const savedOptions = self.warmConnectionOptions ? { ...self.warmConnectionOptions } : null;
      debugLogger.debug("AssemblyAI warm connection closed", {
        wasReady,
        code,
        reasonBytes: reason?.byteLength || reason?.length || 0,
      });
      cleanupWarmConnection(self);
      if (wasReady && savedOptions) {
        self.warmConnectionOptions = savedOptions;
        scheduleRewarm(self);
      } else {
        settleReject(new Error(`AssemblyAI warmup connection closed (${code})`));
      }
    });
  });
}

module.exports = {
  cleanupWarmConnection,
  hasWarmConnection,
  scheduleRewarm,
  startKeepAlive,
  stopKeepAlive,
  useWarmConnection,
  warmupConnection,
};
