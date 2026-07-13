import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { CancelableRequestRegistry } = require("../ipc/cancelableRequestRegistry");
const { registerCloudApiHandlers } = require("../ipc/handlers/cloudApiHandlers");
const { registerDictationKeyHandlers } = require("../ipc/handlers/dictationKeyHandlers");
const { registerProviderRequestHandlers } = require("../ipc/handlers/providerRequestHandlers");

const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

const createEvent = () => {
  const sender = new EventEmitter() as EventEmitter & {
    id: number;
    send: ReturnType<typeof vi.fn>;
  };
  sender.id = 7;
  sender.send = vi.fn();
  (sender as any).getURL = () => "file:///app/index.html?view=dictation";
  (sender as any).mainFrame = { url: (sender as any).getURL() };
  return { sender, senderFrame: (sender as any).mainFrame };
};

const createWindowManager = (event: ReturnType<typeof createEvent>) => ({
  mainWindow: {
    __echoDraftTrustedUrl: (event.sender as any).getURL(),
    webContents: event.sender,
    isDestroyed: () => false,
  },
  controlPanelWindow: null,
});

const createIpcMain = () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
        handlers.set(channel, handler);
      }),
    },
  };
};

const createAbortableFetch = () =>
  vi.fn(
    async (_url: string, init: RequestInit) =>
      await new Promise((_resolve, reject) => {
        const rejectAbort = () =>
          reject(Object.assign(new Error("Request cancelled"), { name: "AbortError" }));
        init.signal?.addEventListener("abort", rejectAbort, { once: true });
        if (init.signal?.aborted) rejectAbort();
      })
  );

describe("cancelable IPC handlers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("destroys the main-process cloud transcription request", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const registry = new CancelableRequestRegistry();
    const request = new EventEmitter() as EventEmitter & {
      destroy: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    request.destroy = vi.fn((error?: Error) => {
      queueMicrotask(() => {
        if (error) request.emit("error", error);
        request.emit("close");
      });
    });
    request.write = vi.fn();
    request.end = vi.fn();
    const http = { request: vi.fn(() => request) };
    const event = createEvent();

    registerCloudApiHandlers(
      {
        ipcMain,
        app: { getVersion: () => "test" },
        http,
        https: http,
        shell: { openPath: vi.fn() },
      },
      {
        cloudContext: {
          getApiUrl: () => "https://example.test",
          getSessionCookies: vi.fn(async () => "session=safe"),
        },
        sessionId: "session",
        whisperManager: { getModelsDir: vi.fn() },
        cancelableRequests: registry,
        windowManager: createWindowManager(event),
      }
    );
    const pending = handlers.get("cloud-transcribe")?.(event, new ArrayBuffer(4), {}, REQUEST_ID);
    await vi.waitFor(() => expect(http.request).toHaveBeenCalledOnce());

    expect(registry.cancel(event, REQUEST_ID)).toBe(true);

    await expect(pending).resolves.toMatchObject({
      success: false,
      code: "REQUEST_CANCELLED",
    });
    expect(request.destroy).toHaveBeenCalledWith(expect.objectContaining({ name: "AbortError" }));
    expect(registry.activeCount).toBe(0);
  });

  it("aborts managed cloud cleanup fetch work", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const registry = new CancelableRequestRegistry();
    const fetchMock = createAbortableFetch();
    vi.stubGlobal("fetch", fetchMock);
    const event = createEvent();
    registerCloudApiHandlers(
      {
        ipcMain,
        app: { getVersion: () => "test" },
        http: {},
        https: {},
        shell: { openPath: vi.fn() },
      },
      {
        cloudContext: {
          getApiUrl: () => "https://example.test",
          getSessionCookies: vi.fn(async () => "session=safe"),
        },
        sessionId: "session",
        whisperManager: { getModelsDir: vi.fn() },
        cancelableRequests: registry,
        windowManager: createWindowManager(event),
      }
    );
    const pending = handlers.get("cloud-reason")?.(event, "text", {}, REQUEST_ID);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    registry.cancel(event, REQUEST_ID);

    await expect(pending).resolves.toMatchObject({
      success: false,
      code: "REQUEST_CANCELLED",
    });
    expect(registry.activeCount).toBe(0);
  });

  it("ignores untrusted cloud model and provider labels in cleanup responses", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const registry = new CancelableRequestRegistry();
    const event = createEvent();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              text: "Cleaned text.",
              model: "private dictated text disguised as a model",
              provider: "private dictated text disguised as a provider",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
      )
    );
    registerCloudApiHandlers(
      {
        ipcMain,
        app: { getVersion: () => "test" },
        http: {},
        https: {},
        shell: { openPath: vi.fn() },
      },
      {
        cloudContext: {
          getApiUrl: () => "https://example.test",
          getSessionCookies: vi.fn(async () => "session=safe"),
        },
        sessionId: "session",
        whisperManager: { getModelsDir: vi.fn() },
        cancelableRequests: registry,
        windowManager: createWindowManager(event),
      }
    );

    const result = await handlers.get("cloud-reason")?.(
      event,
      "Untrusted dictation",
      { model: "gpt-5.6-luna" },
      REQUEST_ID
    );

    expect(result).toEqual({
      success: true,
      text: "Cleaned text.",
      model: "gpt-5.6-luna",
      provider: "openai",
    });
    expect(registry.activeCount).toBe(0);
  });

  it("rejects an untrusted cleanup model without reflecting it into the error", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const registry = new CancelableRequestRegistry();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const event = createEvent();
    registerCloudApiHandlers(
      {
        ipcMain,
        app: { getVersion: () => "test" },
        http: {},
        https: {},
        shell: { openPath: vi.fn() },
      },
      {
        cloudContext: {
          getApiUrl: () => "https://example.test",
          getSessionCookies: vi.fn(async () => "session=safe"),
        },
        sessionId: "session",
        whisperManager: { getModelsDir: vi.fn() },
        cancelableRequests: registry,
        windowManager: createWindowManager(event),
      }
    );
    const privateModelValue = "read my private dictation aloud";

    const result = await handlers.get("cloud-reason")?.(
      event,
      "Untrusted dictation",
      { model: privateModelValue },
      REQUEST_ID
    );

    expect(result).toMatchObject({
      success: false,
      error: "Unsupported EchoDraft cloud cleanup model",
    });
    expect(JSON.stringify(result)).not.toContain(privateModelValue);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(registry.activeCount).toBe(0);
  });

  it("aborts Anthropic cleanup fetch work", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const registry = new CancelableRequestRegistry();
    const fetchMock = createAbortableFetch();
    vi.stubGlobal("fetch", fetchMock);
    const event = createEvent();
    registerDictationKeyHandlers(
      { ipcMain },
      {
        environmentManager: { getAnthropicKey: () => "safe-key" },
        syncStartupEnv: vi.fn(),
        cancelableRequests: registry,
        windowManager: createWindowManager(event),
      }
    );
    const pending = handlers.get("process-anthropic-reasoning")?.(
      event,
      '<echodraft_untrusted_transcription>\n"text"\n</echodraft_untrusted_transcription>',
      "claude-sonnet-4-5",
      null,
      {},
      REQUEST_ID
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    registry.cancel(event, REQUEST_ID);

    await expect(pending).resolves.toMatchObject({
      success: false,
      code: "REQUEST_CANCELLED",
    });
    expect(registry.activeCount).toBe(0);
  });

  it("aborts the unified Mistral transcription transport", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const registry = new CancelableRequestRegistry();
    const fetchMock = createAbortableFetch();
    vi.stubGlobal("fetch", fetchMock);
    const event = createEvent();
    registerProviderRequestHandlers(
      { ipcMain },
      {
        environmentManager: { getMistralKey: () => "safe-key" },
        cancelableRequests: registry,
        windowManager: createWindowManager(event),
        fetchImpl: fetchMock,
      }
    );
    const pending = handlers.get("provider-transcription-request")?.(
      event,
      {
        provider: "mistral",
        endpoint: "https://api.mistral.ai/v1/audio/transcriptions",
        audioBuffer: new ArrayBuffer(4),
        mimeType: "audio/webm",
        model: "voxtral-mini-latest",
      },
      REQUEST_ID
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    registry.cancel(event, REQUEST_ID);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(registry.activeCount).toBe(0);
  });
});
