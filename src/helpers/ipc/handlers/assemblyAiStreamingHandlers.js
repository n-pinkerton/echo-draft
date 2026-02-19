function registerAssemblyAiStreamingHandlers(
  { ipcMain, BrowserWindow, debugLogger, AssemblyAiStreaming },
  { cloudContext, streamingState }
) {
  const { getApiUrl, getSessionCookies } = cloudContext;

  const fetchStreamingToken = async (event) => {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      throw new Error("EchoDraft API URL not configured");
    }

    const cookieHeader = await getSessionCookies(event);
    if (!cookieHeader) {
      throw new Error("No session cookies available");
    }

    const tokenResponse = await fetch(`${apiUrl}/api/streaming-token`, {
      method: "POST",
      headers: {
        Cookie: cookieHeader,
      },
    });

    if (!tokenResponse.ok) {
      if (tokenResponse.status === 401) {
        const err = new Error("Session expired");
        err.code = "AUTH_EXPIRED";
        throw err;
      }
      const errorData = await tokenResponse.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to get streaming token: ${tokenResponse.status}`);
    }

    const { token } = await tokenResponse.json();
    if (!token) {
      throw new Error("No token received from API");
    }

    return token;
  };

  ipcMain.handle("assemblyai-streaming-warmup", async (event, options = {}) => {
    try {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        return { success: false, error: "API not configured", code: "NO_API" };
      }

      if (!streamingState.get()) {
        streamingState.set(new AssemblyAiStreaming());
      }

      if (streamingState.get().hasWarmConnection()) {
        debugLogger.debug("AssemblyAI connection already warm", {}, "streaming");
        return { success: true, alreadyWarm: true };
      }

      let token = streamingState.get().getCachedToken();
      if (!token) {
        debugLogger.debug("Fetching new streaming token for warmup", {}, "streaming");
        token = await fetchStreamingToken(event);
      }

      await streamingState.get().warmup({ ...options, token });
      debugLogger.debug("AssemblyAI connection warmed up", {}, "streaming");

      return { success: true };
    } catch (error) {
      debugLogger.error("AssemblyAI warmup error", { error: error.message });
      if (error.code === "AUTH_EXPIRED") {
        return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
      }
      return { success: false, error: error.message };
    }
  });

  let streamingStartInProgress = false;

  ipcMain.handle("assemblyai-streaming-start", async (event, options = {}) => {
    if (streamingStartInProgress) {
      debugLogger.debug("Streaming start already in progress, ignoring", {}, "streaming");
      return { success: false, error: "Operation in progress" };
    }

    streamingStartInProgress = true;
    try {
      const apiUrl = getApiUrl();
      if (!apiUrl) {
        return { success: false, error: "API not configured", code: "NO_API" };
      }

      const win = BrowserWindow.fromWebContents(event.sender);

      if (!streamingState.get()) {
        streamingState.set(new AssemblyAiStreaming());
      }

      // Clean up any stale active connection (shouldn't happen normally)
      if (streamingState.get().isConnected) {
        debugLogger.debug("AssemblyAI cleaning up stale connection before start", {}, "streaming");
        await streamingState.get().disconnect(false);
      }

      const hasWarm = streamingState.get().hasWarmConnection();
      debugLogger.debug("AssemblyAI streaming start", { hasWarmConnection: hasWarm }, "streaming");

      let token = streamingState.get().getCachedToken();
      if (!token) {
        debugLogger.debug("Fetching streaming token from API", {}, "streaming");
        token = await fetchStreamingToken(event);
        streamingState.get().cacheToken(token);
      } else {
        debugLogger.debug("Using cached streaming token", {}, "streaming");
      }

      // Set up callbacks to forward events to renderer
      streamingState.get().onPartialTranscript = (text) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("assemblyai-partial-transcript", text);
        }
      };

      streamingState.get().onFinalTranscript = (text) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("assemblyai-final-transcript", text);
        }
      };

      streamingState.get().onError = (error) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("assemblyai-error", error.message);
        }
      };

      streamingState.get().onSessionEnd = (data) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send("assemblyai-session-end", data);
        }
      };

      await streamingState.get().connect({ ...options, token });
      debugLogger.debug("AssemblyAI streaming started", {}, "streaming");

      return {
        success: true,
        usedWarmConnection: streamingState.get().hasWarmConnection() === false,
      };
    } catch (error) {
      debugLogger.error("AssemblyAI streaming start error", { error: error.message });
      if (error.code === "AUTH_EXPIRED") {
        return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
      }
      return { success: false, error: error.message };
    } finally {
      streamingStartInProgress = false;
    }
  });

  ipcMain.on("assemblyai-streaming-send", (_event, audioBuffer) => {
    try {
      if (!streamingState.get()) return;
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

  ipcMain.on("assemblyai-streaming-force-endpoint", () => {
    streamingState.get()?.forceEndpoint();
  });

  ipcMain.handle("assemblyai-streaming-stop", async () => {
    try {
      let result = { text: "" };
      if (streamingState.get()) {
        result = await streamingState.get().disconnect(true);
        streamingState.get().cleanupAll();
        streamingState.clear();
      }

      return {
        success: true,
        text: result?.text || "",
        audioDuration: result?.audioDuration ?? null,
        audioStats: result?.audioStats ?? null,
        terminationTimedOut: Boolean(result?.terminationTimedOut),
      };
    } catch (error) {
      debugLogger.error("AssemblyAI streaming stop error", { error: error.message });
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("assemblyai-streaming-status", async () => {
    if (!streamingState.get()) {
      return { isConnected: false, sessionId: null };
    }
    return streamingState.get().getStatus();
  });
}

module.exports = { registerAssemblyAiStreamingHandlers };

