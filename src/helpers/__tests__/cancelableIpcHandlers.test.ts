import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { CancelableRequestRegistry } = require("../ipc/cancelableRequestRegistry");
const { registerCloudApiHandlers } = require("../ipc/handlers/cloudApiHandlers");
const { registerDictationKeyHandlers } = require("../ipc/handlers/dictationKeyHandlers");
const { registerModelManagementHandlers } = require("../ipc/handlers/modelManagementHandlers");

const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

const createEvent = () => {
  const sender = new EventEmitter() as EventEmitter & {
    id: number;
    send: ReturnType<typeof vi.fn>;
  };
  sender.id = 7;
  sender.send = vi.fn();
  return { sender };
};

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
          getApiUrl: () => "http://example.test",
          getSessionCookies: vi.fn(async () => "session=safe"),
        },
        sessionId: "session",
        whisperManager: { getModelsDir: vi.fn() },
        cancelableRequests: registry,
      }
    );
    const event = createEvent();
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
      }
    );
    const event = createEvent();
    const pending = handlers.get("cloud-reason")?.(event, "text", {}, REQUEST_ID);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    registry.cancel(event, REQUEST_ID);

    await expect(pending).resolves.toMatchObject({
      success: false,
      code: "REQUEST_CANCELLED",
    });
    expect(registry.activeCount).toBe(0);
  });

  it("aborts Anthropic cleanup fetch work", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const registry = new CancelableRequestRegistry();
    const fetchMock = createAbortableFetch();
    vi.stubGlobal("fetch", fetchMock);
    registerDictationKeyHandlers(
      { ipcMain },
      {
        environmentManager: { getAnthropicKey: () => "safe-key" },
        syncStartupEnv: vi.fn(),
        cancelableRequests: registry,
      }
    );
    const event = createEvent();
    const pending = handlers.get("process-anthropic-reasoning")?.(
      event,
      "text",
      "claude-test",
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

  it("aborts proxied Mistral transcription fetch work", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const registry = new CancelableRequestRegistry();
    const fetchMock = createAbortableFetch();
    vi.stubGlobal("fetch", fetchMock);
    registerModelManagementHandlers(
      { ipcMain },
      {
        environmentManager: { getMistralKey: () => "safe-key" },
        cancelableRequests: registry,
      }
    );
    const event = createEvent();
    const pending = handlers.get("proxy-mistral-transcription")?.(
      event,
      { audioBuffer: new ArrayBuffer(4), model: "voxtral-mini-latest" },
      REQUEST_ID
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    registry.cancel(event, REQUEST_ID);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(registry.activeCount).toBe(0);
  });
});
