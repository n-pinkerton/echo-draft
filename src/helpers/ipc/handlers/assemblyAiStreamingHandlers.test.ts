import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_REFRESH_OPERATION_RETENTION_MS,
  MAX_STREAMING_AUDIO_CHUNK_BYTES,
  STREAMING_TOKEN_REQUEST_TIMEOUT_MS,
  normalizeStreamingOptions,
  registerAssemblyAiStreamingHandlers,
} from "./assemblyAiStreamingHandlers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const registerStartupHarness = (
  session: any,
  tokenRequestTimeoutMs = 100,
  authRefreshRetentionMs = 1_000,
  getSessionCookies: any = vi.fn(async () => "session=redacted")
) => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const frame = { url: "file:///app/index.html?view=dictation" };
  const sender = { mainFrame: frame, getURL: () => frame.url };
  const event = { sender, senderFrame: frame };
  let currentSession = session;
  const streamingState = {
    get: () => currentSession,
    set: (next: any) => {
      currentSession = next;
    },
    clear: vi.fn(() => {
      currentSession = null;
    }),
  };

  registerAssemblyAiStreamingHandlers(
    {
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          handlers.set(channel, handler);
        }),
        on: vi.fn(),
      },
      BrowserWindow: {
        fromWebContents: vi.fn(() => ({
          isDestroyed: () => false,
          webContents: { send: vi.fn() },
        })),
      },
      debugLogger: { debug: vi.fn(), error: vi.fn(), trace: vi.fn(), warn: vi.fn() },
      AssemblyAiStreaming: vi.fn(() => session),
    } as any,
    {
      cloudContext: {
        getApiUrl: vi.fn(() => "https://example.invalid"),
        getSessionCookies,
      },
      streamingState,
      tokenRequestTimeoutMs,
      authRefreshRetentionMs,
      windowManager: {
        mainWindow: {
          __echoDraftTrustedUrl: frame.url,
          webContents: sender,
          isDestroyed: () => false,
        },
        controlPanelWindow: null,
      },
    } as any
  );

  return {
    invokeStart: (options: any = {}) => handlers.get("assemblyai-streaming-start")?.(event, options),
    invokeStop: () => handlers.get("assemblyai-streaming-stop")?.(event),
  };
};

const registerStopHandler = (initialSession: any) => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn(),
  };
  let session = initialSession;
  const streamingState = {
    get: () => session,
    set: (next: any) => {
      session = next;
    },
    clear: vi.fn(() => {
      session = null;
    }),
  };
  const frame = { url: "file:///app/index.html?view=dictation" };
  const sender = { mainFrame: frame, getURL: () => frame.url };
  const event = { sender, senderFrame: frame };

  registerAssemblyAiStreamingHandlers(
    {
      ipcMain,
      BrowserWindow: { fromWebContents: vi.fn() },
      debugLogger: { debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
      AssemblyAiStreaming: vi.fn(),
    } as any,
    {
      cloudContext: {
        getApiUrl: vi.fn(() => "https://example.invalid"),
        getSessionCookies: vi.fn(async () => "session=redacted"),
      },
      streamingState,
      windowManager: {
        mainWindow: {
          __echoDraftTrustedUrl: frame.url,
          webContents: sender,
          isDestroyed: () => false,
        },
        controlPanelWindow: null,
      },
    } as any
  );

  return {
    invokeStop: () => handlers.get("assemblyai-streaming-stop")?.(event),
    streamingState,
  };
};

const registerStartHandler = (connectionMetadata: { usedWarmConnection: boolean }) => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const frame = { url: "file:///app/index.html?view=dictation" };
  const sender = { mainFrame: frame, getURL: () => frame.url };
  const event = { sender, senderFrame: frame };
  const session = {
    hasWarmConnection: vi.fn(() => true),
    getCachedToken: vi.fn(() => "cached-token"),
    connect: vi.fn(async () => connectionMetadata),
  };

  registerAssemblyAiStreamingHandlers(
    {
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          handlers.set(channel, handler);
        }),
        on: vi.fn(),
      },
      BrowserWindow: { fromWebContents: vi.fn(() => ({ isDestroyed: () => false })) },
      debugLogger: { debug: vi.fn(), error: vi.fn(), trace: vi.fn() },
      AssemblyAiStreaming: vi.fn(),
    } as any,
    {
      cloudContext: { getApiUrl: vi.fn(() => "https://example.invalid") },
      streamingState: { get: () => session, set: vi.fn(), clear: vi.fn() },
      windowManager: {
        mainWindow: {
          __echoDraftTrustedUrl: frame.url,
          webContents: sender,
          isDestroyed: () => false,
        },
        controlPanelWindow: null,
      },
    } as any
  );

  return () => handlers.get("assemblyai-streaming-start")?.(event, {});
};

describe("AssemblyAI streaming stop IPC", () => {
  it.each([true, false])("reports explicit warm connection metadata (%s)", async (usedWarm) => {
    await expect(registerStartHandler({ usedWarmConnection: usedWarm })()).resolves.toMatchObject({
      success: true,
      usedWarmConnection: usedWarm,
    });
  });

  it("normalizes the renderer options to the supported streaming contract", () => {
    expect(
      normalizeStreamingOptions({
        sampleRate: 96_000,
        language: "en-NZ",
        token: "must-not-cross-the-boundary",
      })
    ).toEqual({ sampleRate: 16_000, language: "en-NZ" });
    expect(normalizeStreamingOptions({ sampleRate: 48_000, language: "../../private" })).toEqual({
      sampleRate: 48_000,
    });
    expect(normalizeStreamingOptions({ sampleRate: 48_000, language: "zzz" })).toEqual({
      sampleRate: 48_000,
    });
    expect(normalizeStreamingOptions({ sampleRate: 48_000, language: "mi" })).toEqual({
      sampleRate: 48_000,
    });
    expect(MAX_STREAMING_AUDIO_CHUNK_BYTES).toBe(1024 * 1024);
    expect(STREAMING_TOKEN_REQUEST_TIMEOUT_MS).toBe(15_000);
    expect(AUTH_REFRESH_OPERATION_RETENTION_MS).toBe(30_000);
  });

  it("fails closed when there is no active session", async () => {
    const { invokeStop } = registerStopHandler(null);

    await expect(invokeStop()).resolves.toMatchObject({
      success: false,
      text: "",
      terminationConfirmed: false,
    });
  });

  it("strips partial text when termination was not confirmed", async () => {
    const session = {
      disconnect: vi.fn(async () => ({
        text: "must not cross IPC",
        terminationConfirmed: false,
        terminationUnavailable: true,
      })),
      cleanupAll: vi.fn(),
    };
    const { invokeStop, streamingState } = registerStopHandler(session);

    await expect(invokeStop()).resolves.toMatchObject({
      success: false,
      text: "",
      terminationConfirmed: false,
    });
    expect(session.cleanupAll).toHaveBeenCalledTimes(1);
    expect(streamingState.clear).toHaveBeenCalledTimes(1);
  });

  it("times out a never-settling token response body without caching or connecting", async () => {
    vi.useFakeTimers();
    const session = {
      isConnected: false,
      hasWarmConnection: vi.fn(() => false),
      getCachedToken: vi.fn(() => null),
      cacheToken: vi.fn(),
      connect: vi.fn(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init: any) => {
        const body = new ReadableStream({
          start(controller) {
            init.signal.addEventListener("abort", () => controller.error(init.signal.reason), {
              once: true,
            });
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      })
    );
    const { invokeStart } = registerStartupHarness(session, 100);

    const start = invokeStart({ startupRequestId: "timeout-start" });
    await vi.advanceTimersByTimeAsync(100);

    await expect(start).resolves.toMatchObject({
      success: false,
      code: "STREAMING_TOKEN_TIMEOUT",
    });
    expect(session.cacheToken).not.toHaveBeenCalled();
    expect(session.connect).not.toHaveBeenCalled();
  });

  it("times out token acquisition even when cookie lookup never settles", async () => {
    vi.useFakeTimers();
    const session = {
      isConnected: false,
      hasWarmConnection: vi.fn(() => false),
      getCachedToken: vi.fn(() => null),
      cacheToken: vi.fn(),
      connect: vi.fn(),
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const getSessionCookies = vi.fn(() => new Promise(() => {}));
    const { invokeStart } = registerStartupHarness(session, 100, 1_000, getSessionCookies);

    const start = invokeStart({ startupRequestId: "cookie-timeout" });
    await vi.advanceTimersByTimeAsync(100);

    await expect(start).resolves.toMatchObject({
      success: false,
      code: "STREAMING_TOKEN_TIMEOUT",
    });
    expect(getSessionCookies).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(session.cacheToken).not.toHaveBeenCalled();
    expect(session.connect).not.toHaveBeenCalled();
  });

  it("aborts token acquisition when stop is requested during startup", async () => {
    let requestSignal: AbortSignal | undefined;
    const session = {
      isConnected: false,
      hasWarmConnection: vi.fn(() => false),
      getCachedToken: vi.fn(() => null),
      cacheToken: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(async () => ({ terminationConfirmed: false })),
      cleanupAll: vi.fn(),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init: any) => {
        requestSignal = init.signal;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        });
      })
    );
    const { invokeStart, invokeStop } = registerStartupHarness(session);

    const start = invokeStart({ startupRequestId: "cancel-start" });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await invokeStop();

    await expect(start).resolves.toMatchObject({
      success: false,
      code: "STREAMING_START_CANCELLED",
    });
    expect(requestSignal?.aborted).toBe(true);
    expect(session.cacheToken).not.toHaveBeenCalled();
    expect(session.connect).not.toHaveBeenCalled();
  });

  it("keeps cancellation attached to an auth-refresh retry", async () => {
    const session = {
      isConnected: false,
      hasWarmConnection: vi.fn(() => false),
      getCachedToken: vi.fn(() => null),
      cacheToken: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(async () => ({ terminationConfirmed: false })),
      cleanupAll: vi.fn(),
    };
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { invokeStart, invokeStop } = registerStartupHarness(session);
    const options = { startupRequestId: "auth-refresh-start" };

    await expect(invokeStart(options)).resolves.toMatchObject({
      success: false,
      code: "AUTH_EXPIRED",
    });
    await invokeStop();
    await expect(invokeStart(options)).resolves.toMatchObject({
      success: false,
      code: "STREAMING_START_CANCELLED",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(session.cacheToken).not.toHaveBeenCalled();
    expect(session.connect).not.toHaveBeenCalled();
  });

  it("expires an abandoned auth-refresh operation before accepting the same request ID", async () => {
    vi.useFakeTimers();
    const session = {
      isConnected: false,
      hasWarmConnection: vi.fn(() => false),
      getCachedToken: vi.fn(() => null),
      cacheToken: vi.fn(),
      connect: vi.fn(),
    };
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { invokeStart } = registerStartupHarness(session, 100, 250);
    const options = { startupRequestId: "abandoned-auth-refresh" };

    await expect(invokeStart(options)).resolves.toMatchObject({ code: "AUTH_EXPIRED" });
    await vi.advanceTimersByTimeAsync(250);
    await expect(invokeStart(options)).resolves.toMatchObject({ code: "AUTH_EXPIRED" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("disconnects a late connection completion after startup cancellation", async () => {
    let resolveConnect!: (value: any) => void;
    const session = {
      isConnected: false,
      hasWarmConnection: vi.fn(() => true),
      getCachedToken: vi.fn(() => "cached-token"),
      connect: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveConnect = resolve;
          })
      ),
      disconnect: vi.fn(async () => ({ terminationConfirmed: false })),
      cleanupAll: vi.fn(),
    };
    const { invokeStart, invokeStop } = registerStartupHarness(session);

    const start = invokeStart({ startupRequestId: "late-connect" });
    await vi.waitFor(() => expect(session.connect).toHaveBeenCalledOnce());
    await invokeStop();
    resolveConnect({ usedWarmConnection: true });

    await expect(start).resolves.toMatchObject({
      success: false,
      code: "STREAMING_START_CANCELLED",
    });
    expect(session.disconnect).toHaveBeenCalledTimes(2);
  });
});
