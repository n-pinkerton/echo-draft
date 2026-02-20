const debugLogger = require("../debugLogger");

const { createAudioStats } = require("./audioStats");
const { getCachedToken, isTokenValid } = require("./tokenCache");
const { buildAssemblyAiWebSocketUrl } = require("./urlBuilder");
const {
  cleanupWarmConnection,
  hasWarmConnection,
  scheduleRewarm,
  startKeepAlive,
  stopKeepAlive,
  useWarmConnection,
  warmupConnection,
} = require("./warmConnection");
const {
  cleanupAll,
  cleanupSession,
  connectSession,
  disconnectSession,
  forceEndpoint,
  getAudioStats,
  getStatus,
  handleSessionMessage,
  sendAudioChunk,
} = require("./sessionConnection");

class AssemblyAiStreaming {
  constructor() {
    this.ws = null;
    this.sessionId = null;
    this.isConnected = false;
    this.onPartialTranscript = null;
    this.onFinalTranscript = null;
    this.onError = null;
    this.onSessionEnd = null;
    this.pendingResolve = null;
    this.pendingReject = null;
    this.connectionTimeout = null;
    this.accumulatedText = "";
    this.lastTurnText = "";
    this.turns = [];
    this.terminationResolve = null;
    this.cachedToken = null;
    this.tokenFetchedAt = null;
    this.warmConnection = null;
    this.warmConnectionReady = false;
    this.warmConnectionOptions = null;
    this.warmSessionId = null;
    this.rewarmAttempts = 0;
    this.rewarmTimer = null;
    this.keepAliveInterval = null;
    this.isDisconnecting = false;

    this.audioStats = createAudioStats();
  }

  resetAudioStats() {
    this.audioStats = createAudioStats();
  }

  getAudioStats() {
    return getAudioStats(this);
  }

  buildWebSocketUrl(options) {
    return buildAssemblyAiWebSocketUrl(options);
  }

  cacheToken(token) {
    this.cachedToken = token;
    this.tokenFetchedAt = Date.now();
    debugLogger.debug("AssemblyAI token cached");
  }

  isTokenValid() {
    return isTokenValid(this.cachedToken, this.tokenFetchedAt);
  }

  getCachedToken() {
    return getCachedToken(this.cachedToken, this.tokenFetchedAt);
  }

  startKeepAlive() {
    return startKeepAlive(this);
  }

  stopKeepAlive() {
    return stopKeepAlive(this);
  }

  async warmup(options = {}) {
    return await warmupConnection(this, options);
  }

  scheduleRewarm() {
    return scheduleRewarm(this);
  }

  useWarmConnection() {
    return useWarmConnection(this);
  }

  cleanupWarmConnection() {
    return cleanupWarmConnection(this);
  }

  hasWarmConnection() {
    return hasWarmConnection(this);
  }

  async connect(options = {}) {
    return await connectSession(this, options);
  }

  handleMessage(data) {
    return handleSessionMessage(this, data);
  }

  sendAudio(pcmBuffer) {
    return sendAudioChunk(this, pcmBuffer);
  }

  forceEndpoint() {
    return forceEndpoint(this);
  }

  async disconnect(terminate = true) {
    return await disconnectSession(this, terminate);
  }

  cleanup() {
    return cleanupSession(this);
  }

  cleanupAll() {
    this.cleanupWarmConnection();
    clearTimeout(this.rewarmTimer);
    this.rewarmTimer = null;
    cleanupAll(this);
  }

  getStatus() {
    return getStatus(this);
  }
}

module.exports = AssemblyAiStreaming;

