import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const { CancelableRequestRegistry } = require("../cancelableRequestRegistry");
const { registerParakeetHandlers } = require("./parakeetHandlers");
const { registerWhisperHandlers } = require("./whisperHandlers");

const REQUEST_ID = "local-request-00000000001";

const createEvent = () => {
  const sender = new EventEmitter() as EventEmitter & {
    id: number;
    send: ReturnType<typeof vi.fn>;
  };
  sender.id = 77;
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

const abortableManagerMethod = vi.fn(
  async (_audio: unknown, _options: unknown, runtime: { signal: AbortSignal }) =>
    await new Promise((_resolve, reject) => {
      runtime.signal.addEventListener(
        "abort",
        () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })),
        { once: true }
      );
    })
);

describe("cancelable local transcription IPC", () => {
  it("aborts Whisper work in the main process and releases its request scope", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const registry = new CancelableRequestRegistry();
    const event = createEvent();
    const transcribeLocalWhisper = abortableManagerMethod;
    transcribeLocalWhisper.mockClear();
    registerWhisperHandlers(
      { ipcMain },
      { whisperManager: { transcribeLocalWhisper }, cancelableRequests: registry }
    );

    const pending = handlers.get("transcribe-local-whisper")?.(
      event,
      new Uint8Array([1]),
      { model: "base" },
      REQUEST_ID
    );
    await vi.waitFor(() => expect(transcribeLocalWhisper).toHaveBeenCalledOnce());
    const runtime = transcribeLocalWhisper.mock.calls[0][2];

    expect(registry.cancel(event, REQUEST_ID)).toBe(true);
    await expect(pending).resolves.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(runtime.signal.aborted).toBe(true);
    expect(registry.activeCount).toBe(0);
  });

  it("aborts Parakeet work in the main process and releases its request scope", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const registry = new CancelableRequestRegistry();
    const event = createEvent();
    const transcribeLocalParakeet = abortableManagerMethod;
    transcribeLocalParakeet.mockClear();
    registerParakeetHandlers(
      { ipcMain },
      {
        parakeetManager: { transcribeLocalParakeet },
        environmentManager: { saveAllKeysToEnvFile: vi.fn() },
        cancelableRequests: registry,
      }
    );

    const pending = handlers.get("transcribe-local-parakeet")?.(
      event,
      new Uint8Array([1]),
      { model: "parakeet-tdt-0.6b-v3" },
      REQUEST_ID
    );
    await vi.waitFor(() => expect(transcribeLocalParakeet).toHaveBeenCalledOnce());
    const runtime = transcribeLocalParakeet.mock.calls[0][2];

    expect(registry.cancel(event, REQUEST_ID)).toBe(true);
    await expect(pending).resolves.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(runtime.signal.aborted).toBe(true);
    expect(registry.activeCount).toBe(0);
  });
});
