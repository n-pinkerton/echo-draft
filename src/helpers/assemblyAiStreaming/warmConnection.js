const WebSocket = require("ws");

const debugLogger = require("../debugLogger");
const {
  KEEPALIVE_INTERVAL_MS,
  MAX_REWARM_ATTEMPTS,
  REWARM_DELAY_MS,
  WEBSOCKET_TIMEOUT_MS,
} = require("./constants");
const { buildAssemblyAiWebSocketUrl } = require("./urlBuilder");

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
    debugLogger.error("AssemblyAI WebSocket error", { error: error.message });
    self.cleanup();
    self.onError?.(error);
  });

  self.ws.removeAllListeners("close");
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
    const warmupTimeout = setTimeout(() => {
      cleanupWarmConnection(self);
      reject(new Error("AssemblyAI warmup connection timeout"));
    }, WEBSOCKET_TIMEOUT_MS);

    self.warmConnection = new WebSocket(url);

    self.warmConnection.on("open", () => {
      debugLogger.debug("AssemblyAI warm connection socket opened");
    });

    self.warmConnection.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "Begin") {
          clearTimeout(warmupTimeout);
          self.warmConnectionReady = true;
          self.warmSessionId = message.id || null;
          startKeepAlive(self);
          debugLogger.debug("AssemblyAI connection warmed up", { sessionId: message.id });
          resolve();
        }
      } catch (err) {
        debugLogger.error("AssemblyAI warmup message parse error", { error: err.message });
      }
    });

    self.warmConnection.on("error", (error) => {
      clearTimeout(warmupTimeout);
      debugLogger.error("AssemblyAI warmup connection error", { error: error.message });
      cleanupWarmConnection(self);
      reject(error);
    });

    self.warmConnection.on("close", (code, reason) => {
      clearTimeout(warmupTimeout);
      stopKeepAlive(self);
      const wasReady = self.warmConnectionReady;
      const savedOptions = self.warmConnectionOptions ? { ...self.warmConnectionOptions } : null;
      debugLogger.debug("AssemblyAI warm connection closed", {
        wasReady,
        code,
        reason: reason?.toString(),
      });
      cleanupWarmConnection(self);
      if (wasReady && savedOptions) {
        self.warmConnectionOptions = savedOptions;
        scheduleRewarm(self);
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

