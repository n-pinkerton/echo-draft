const { requireTrustedRenderer } = require("../trustedRenderer");
const { buildCloudRequestUrl } = require("../cloud/cloudContext");
const { readResponseJsonBounded, rejectRedirectResponse } = require("./cloudApiHandlers");
const { normalizeLanguageCode } = require("../../../utils/languagePolicy.cjs");
const {
  getSafeErrorCode,
  toPublicStreamingError,
} = require("../../assemblyAiStreaming/publicErrors");

const MAX_STREAMING_AUDIO_CHUNK_BYTES = 1024 * 1024;
const STREAMING_TOKEN_REQUEST_TIMEOUT_MS = 15_000;
const AUTH_REFRESH_OPERATION_RETENTION_MS = 30_000;
const MAX_CANCELLED_STARTUP_REQUEST_IDS = 64;

const createStreamingStartupError = (code) => {
  const error = new Error("The streaming service could not be started");
  error.code = code;
  return error;
};

const throwIfStartupCancelled = (operation) => {
  if (operation.controller.signal.aborted) {
    throw (
      operation.controller.signal.reason ||
      createStreamingStartupError("STREAMING_START_CANCELLED")
    );
  }
};

const raceStartupOperation = async (promise, operation) => {
  throwIfStartupCancelled(operation);
  const { signal } = operation.controller;
  return await new Promise((resolve, reject) => {
    const onAbort = () =>
      reject(signal.reason || createStreamingStartupError("STREAMING_START_CANCELLED"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
};

const normalizeStreamingOptions = (value) => {
  const options = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sampleRate = Number(options.sampleRate);
  const language = normalizeLanguageCode(options.language, {
    allowAuto: true,
    capability: "assemblyai",
  });
  return {
    sampleRate:
      Number.isFinite(sampleRate) && sampleRate >= 8_000 && sampleRate <= 48_000
        ? Math.round(sampleRate)
        : 16_000,
    ...(language ? { language } : {}),
  };
};

const binaryByteLength = (value) => {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (Buffer.isBuffer(value)) return value.length;
  return -1;
};

function registerAssemblyAiStreamingHandlers(
  { ipcMain, BrowserWindow, debugLogger, AssemblyAiStreaming },
  {
    cloudContext,
    streamingState,
    windowManager,
    tokenRequestTimeoutMs = STREAMING_TOKEN_REQUEST_TIMEOUT_MS,
    authRefreshRetentionMs = AUTH_REFRESH_OPERATION_RETENTION_MS,
  }
) {
  const { getApiUrl, getSessionCookies } = cloudContext;
  const pendingStartOperations = new Map();
  const cancelledStartupRequestIds = new Map();
  let pendingWarmupOperation = null;

  const pruneCancelledStartupRequestIds = (now = Date.now()) => {
    for (const [requestId, expiresAt] of cancelledStartupRequestIds) {
      if (expiresAt <= now) cancelledStartupRequestIds.delete(requestId);
    }
    while (cancelledStartupRequestIds.size > MAX_CANCELLED_STARTUP_REQUEST_IDS) {
      cancelledStartupRequestIds.delete(cancelledStartupRequestIds.keys().next().value);
    }
  };

  const rememberCancelledStartupRequestId = (requestId) => {
    if (!requestId) return;
    pruneCancelledStartupRequestIds();
    cancelledStartupRequestIds.delete(requestId);
    cancelledStartupRequestIds.set(requestId, Date.now() + authRefreshRetentionMs);
    pruneCancelledStartupRequestIds();
  };

  const createStartupOperation = (kind, requestId = null) => {
    if (requestId && pendingStartOperations.has(requestId)) {
      const retained = pendingStartOperations.get(requestId);
      if (retained.retentionTimeout) clearTimeout(retained.retentionTimeout);
      retained.retentionTimeout = null;
      return retained;
    }

    pruneCancelledStartupRequestIds();
    if (requestId && cancelledStartupRequestIds.has(requestId)) {
      cancelledStartupRequestIds.delete(requestId);
      const controller = new AbortController();
      controller.abort(createStreamingStartupError("STREAMING_START_CANCELLED"));
      return { controller, kind, requestId, timeout: null, retentionTimeout: null };
    }

    const controller = new AbortController();
    const operation = {
      controller,
      kind,
      requestId,
      timeout: null,
      retentionTimeout: null,
    };
    if (kind === "start") {
      pendingStartOperations.set(requestId || operation, operation);
    } else {
      pendingWarmupOperation?.controller.abort(
        createStreamingStartupError("STREAMING_START_CANCELLED")
      );
      pendingWarmupOperation = operation;
    }
    return operation;
  };

  const releaseStartupOperation = (operation, { retainForAuthRefresh = false } = {}) => {
    if (retainForAuthRefresh && operation.requestId && !operation.controller.signal.aborted) {
      if (operation.retentionTimeout) clearTimeout(operation.retentionTimeout);
      operation.retentionTimeout = setTimeout(() => {
        operation.retentionTimeout = null;
        if (pendingStartOperations.get(operation.requestId) === operation) {
          pendingStartOperations.delete(operation.requestId);
          operation.controller.abort(createStreamingStartupError("STREAMING_START_CANCELLED"));
        }
      }, authRefreshRetentionMs);
      return;
    }
    if (operation.timeout) clearTimeout(operation.timeout);
    if (operation.retentionTimeout) clearTimeout(operation.retentionTimeout);
    if (operation.kind === "start") {
      const key = operation.requestId || operation;
      if (pendingStartOperations.get(key) === operation) pendingStartOperations.delete(key);
    } else if (pendingWarmupOperation === operation) {
      pendingWarmupOperation = null;
    }
  };

  const cancelPendingStartupOperations = () => {
    const cancellation = createStreamingStartupError("STREAMING_START_CANCELLED");
    for (const [key, operation] of pendingStartOperations) {
      rememberCancelledStartupRequestId(operation.requestId);
      if (operation.timeout) clearTimeout(operation.timeout);
      if (operation.retentionTimeout) clearTimeout(operation.retentionTimeout);
      operation.controller.abort(cancellation);
      pendingStartOperations.delete(key);
    }
    pendingWarmupOperation?.controller.abort(cancellation);
  };

  const fetchStreamingToken = async (event, operation) => {
    operation.timeout = setTimeout(() => {
      operation.controller.abort(createStreamingStartupError("STREAMING_TOKEN_TIMEOUT"));
    }, tokenRequestTimeoutMs);
    try {
      throwIfStartupCancelled(operation);
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        throw new Error("EchoDraft API URL not configured");
      }
      const requestUrl = buildCloudRequestUrl(apiUrl, "/api/streaming-token");

      const cookieHeader = await raceStartupOperation(
        getSessionCookies(event, requestUrl),
        operation
      );
      throwIfStartupCancelled(operation);
      if (!cookieHeader) {
        throw new Error("No session cookies available");
      }

      const tokenResponse = await raceStartupOperation(
        fetch(requestUrl, {
          method: "POST",
          redirect: "manual",
          headers: {
            Cookie: cookieHeader,
          },
          signal: operation.controller.signal,
        }),
        operation
      );
      throwIfStartupCancelled(operation);
      rejectRedirectResponse(tokenResponse, "Streaming-token request");

      if (!tokenResponse.ok) {
        if (tokenResponse.status === 401) {
          const err = new Error("Session expired");
          err.code = "AUTH_EXPIRED";
          throw err;
        }
        await tokenResponse.body?.cancel?.().catch(() => {});
        const error = new Error("The streaming service could not be started");
        error.code = "STREAMING_TOKEN_FAILED";
        throw error;
      }

      const { token } = await raceStartupOperation(readResponseJsonBounded(tokenResponse), operation);
      throwIfStartupCancelled(operation);
      if (
        typeof token !== "string" ||
        token.length < 16 ||
        token.length > 8192 ||
        /[\u0000-\u0020\u007f]/.test(token)
      ) {
        throw new Error("No token received from API");
      }

      return token;
    } catch (error) {
      if (operation.controller.signal.aborted) {
        throwIfStartupCancelled(operation);
      }
      throw error;
    } finally {
      if (operation.timeout) clearTimeout(operation.timeout);
      operation.timeout = null;
    }
  };

  ipcMain.handle("assemblyai-streaming-warmup", async (event, options = {}) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    const operation = createStartupOperation("warmup");
    let session = null;
    let warmupAttempted = false;
    try {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        return { success: false, error: "API not configured", code: "NO_API" };
      }

      if (!streamingState.get()) {
        streamingState.set(new AssemblyAiStreaming());
      }
      session = streamingState.get();

      if (session.hasWarmConnection()) {
        debugLogger.debug("AssemblyAI connection already warm", {}, "streaming");
        return { success: true, alreadyWarm: true };
      }

      let token = session.getCachedToken();
      if (!token) {
        debugLogger.debug("Fetching new streaming token for warmup", {}, "streaming");
        token = await fetchStreamingToken(event, operation);
      }

      throwIfStartupCancelled(operation);
      warmupAttempted = true;
      await session.warmup({ ...normalizeStreamingOptions(options), token });
      throwIfStartupCancelled(operation);
      debugLogger.debug("AssemblyAI connection warmed up", {}, "streaming");

      return { success: true };
    } catch (error) {
      if (operation.controller.signal.aborted && warmupAttempted) {
        await session?.disconnect?.(false).catch(() => {});
      }
      debugLogger.error("AssemblyAI warmup error", {
        errorCategory: getSafeErrorCode(error),
      });
      if (error.code === "AUTH_EXPIRED") {
        return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
      }
      const publicError = toPublicStreamingError(error);
      return { success: false, error: publicError.message, code: publicError.code };
    } finally {
      releaseStartupOperation(operation);
    }
  });

  let streamingStartInProgress = false;

  ipcMain.handle("assemblyai-streaming-start", async (event, options = {}) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    if (streamingStartInProgress) {
      debugLogger.debug("Streaming start already in progress, ignoring", {}, "streaming");
      return { success: false, error: "Operation in progress" };
    }

    streamingStartInProgress = true;
    const startupRequestId =
      typeof options?.startupRequestId === "string" && options.startupRequestId.length <= 128
        ? options.startupRequestId
        : null;
    const operation = createStartupOperation("start", startupRequestId);
    let session = null;
    let connectAttempted = false;
    let retainForAuthRefresh = false;
    try {
      throwIfStartupCancelled(operation);
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        return { success: false, error: "API not configured", code: "NO_API" };
      }

      const win = BrowserWindow.fromWebContents(event.sender);

      if (!streamingState.get()) {
        streamingState.set(new AssemblyAiStreaming());
      }
      session = streamingState.get();

      // Clean up any stale active connection (shouldn't happen normally)
      if (session.isConnected) {
        debugLogger.debug("AssemblyAI cleaning up stale connection before start", {}, "streaming");
        await session.disconnect(false);
        throwIfStartupCancelled(operation);
      }

      const hasWarm = session.hasWarmConnection();
      debugLogger.debug("AssemblyAI streaming start", { hasWarmConnection: hasWarm }, "streaming");

      let token = session.getCachedToken();
      if (!token) {
        debugLogger.debug("Fetching streaming token from API", {}, "streaming");
        token = await fetchStreamingToken(event, operation);
        throwIfStartupCancelled(operation);
        session.cacheToken(token);
      } else {
        debugLogger.debug("Using cached streaming token", {}, "streaming");
      }

      // Set up callbacks to forward events to renderer
      session.onPartialTranscript = (text) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("assemblyai-partial-transcript", text);
        }
      };

      session.onFinalTranscript = (text) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("assemblyai-final-transcript", text);
        }
      };

      session.onError = (error) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("assemblyai-error", toPublicStreamingError(error).message);
        }
      };

      session.onSessionEnd = (data) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("assemblyai-session-end", data);
        }
      };

      throwIfStartupCancelled(operation);
      connectAttempted = true;
      const connection = await session.connect({ ...normalizeStreamingOptions(options), token });
      throwIfStartupCancelled(operation);
      debugLogger.debug("AssemblyAI streaming started", {}, "streaming");

      return {
        success: true,
        usedWarmConnection: connection?.usedWarmConnection === true,
      };
    } catch (error) {
      if (operation.controller.signal.aborted && connectAttempted) {
        await session?.disconnect?.(false).catch(() => {});
      }
      debugLogger.error("AssemblyAI streaming start error", {
        errorCategory: getSafeErrorCode(error),
      });
      if (error.code === "AUTH_EXPIRED") {
        retainForAuthRefresh = Boolean(startupRequestId);
        return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
      }
      const publicError = toPublicStreamingError(error);
      return { success: false, error: publicError.message, code: publicError.code };
    } finally {
      streamingStartInProgress = false;
      releaseStartupOperation(operation, { retainForAuthRefresh });
    }
  });

  ipcMain.on("assemblyai-streaming-send", (event, audioBuffer) => {
    try {
      requireTrustedRenderer(event, windowManager, ["dictation"]);
      if (!streamingState.get()) return;
      const byteLength = binaryByteLength(audioBuffer);
      if (byteLength < 1 || byteLength > MAX_STREAMING_AUDIO_CHUNK_BYTES) {
        throw new Error("Streaming audio chunk is missing or too large");
      }
      const buffer = Buffer.from(audioBuffer);
      const ok = streamingState.get().sendAudio(buffer);
      if (!ok) {
        debugLogger.trace(
          "AssemblyAI audio chunk dropped (socket not open)",
          {
            bytes: buffer.length,
            isConnected: streamingState.get().isConnected,
            sessionId: streamingState.get().sessionId,
            readyState: streamingState.get().ws?.readyState,
            bufferedAmount: streamingState.get().ws?.bufferedAmount,
          },
          "streaming"
        );
      }
    } catch (error) {
      debugLogger.error("AssemblyAI streaming send error", { error: error.message });
    }
  });

  ipcMain.on("assemblyai-streaming-force-endpoint", (event) => {
    try {
      requireTrustedRenderer(event, windowManager, ["dictation"]);
      streamingState.get()?.forceEndpoint();
    } catch (error) {
      debugLogger.warn("Rejected untrusted streaming endpoint request", {
        error: error?.message || String(error),
      });
    }
  });

  ipcMain.handle("assemblyai-streaming-stop", async (event) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    cancelPendingStartupOperations();
    const session = streamingState.get();
    if (!session) {
      return {
        success: false,
        text: "",
        error: "No active streaming session to finalize",
        terminationConfirmed: false,
        terminationTimedOut: false,
      };
    }

    try {
      const result = await session.disconnect(true);
      const terminationConfirmed = result?.terminationConfirmed === true;

      return {
        success: terminationConfirmed,
        text: terminationConfirmed ? result?.text || "" : "",
        ...(terminationConfirmed
          ? {}
          : { error: "The streaming service did not confirm transcription completion" }),
        audioDuration: result?.audioDuration ?? null,
        audioStats: result?.audioStats ?? null,
        terminationConfirmed,
        terminationTimedOut: Boolean(result?.terminationTimedOut),
      };
    } catch (error) {
      debugLogger.error("AssemblyAI streaming stop error", {
        errorCategory: getSafeErrorCode(error),
      });
      const publicError = toPublicStreamingError(error);
      return {
        success: false,
        text: "",
        error: publicError.message,
        code: publicError.code,
        terminationConfirmed: false,
        terminationTimedOut: false,
      };
    } finally {
      session.cleanupAll();
      if (streamingState.get() === session) {
        streamingState.clear();
      }
    }
  });

  ipcMain.handle("assemblyai-streaming-status", async (event) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    if (!streamingState.get()) {
      return { isConnected: false, sessionId: null };
    }
    return streamingState.get().getStatus();
  });
}

module.exports = {
  AUTH_REFRESH_OPERATION_RETENTION_MS,
  MAX_STREAMING_AUDIO_CHUNK_BYTES,
  STREAMING_TOKEN_REQUEST_TIMEOUT_MS,
  normalizeStreamingOptions,
  registerAssemblyAiStreamingHandlers,
  toPublicStreamingError,
};
