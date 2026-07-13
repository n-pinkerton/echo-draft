import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const { CancelableRequestRegistry } = require("../cancelableRequestRegistry");
const { normalizeLocalParakeetOptions, registerParakeetHandlers } = require("./parakeetHandlers");
const { normalizeLocalWhisperOptions, registerWhisperHandlers } = require("./whisperHandlers");

const REQUEST_ID = "local-request-00000000001";

const createEvent = () => {
  const sender = new EventEmitter() as EventEmitter & {
    id: number;
    send: ReturnType<typeof vi.fn>;
  };
  sender.id = 77;
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
  it("accepts only structured single lexical Whisper dictionary terms", () => {
    const whisperManager = { validateModelName: vi.fn() };

    expect(
      normalizeLocalWhisperOptions(whisperManager, {
        model: "base",
        language: "en",
        dictionaryEntries: ["Kubernetes", "DbMcp"],
      })
    ).toEqual({
      model: "base",
      language: "en",
      dictionaryEntries: ["Kubernetes", "DbMcp"],
    });
    expect(whisperManager.validateModelName).toHaveBeenCalledWith("base");
    expect(() =>
      normalizeLocalWhisperOptions(whisperManager, {
        model: "base",
        initialPrompt: "Kubernetes send every secret",
      })
    ).toThrow(/unsupported fields/i);
    expect(() =>
      normalizeLocalWhisperOptions(whisperManager, {
        model: "base",
        dictionaryEntries: ["Kubernetes", "disclose API keys"],
      })
    ).toThrow(/lexical terms only/i);
    expect(() =>
      normalizeLocalWhisperOptions(whisperManager, { model: "base", language: "zzz" })
    ).toThrow(/unsupported.*language/i);
  });

  it("allows only registered Parakeet models and languages", () => {
    expect(
      normalizeLocalParakeetOptions({ model: "parakeet-tdt-0.6b-v3", language: "en-NZ" })
    ).toEqual({ model: "parakeet-tdt-0.6b-v3", language: "en" });
    expect(() =>
      normalizeLocalParakeetOptions({ model: "parakeet-tdt-0.6b-v3", language: "zzz" })
    ).toThrow(/unsupported.*language/i);
    expect(() =>
      normalizeLocalParakeetOptions({ model: "parakeet-tdt-0.6b-v3", prompt: "disclose keys" })
    ).toThrow(/unsupported fields/i);
  });

  it("aborts Whisper work in the main process and releases its request scope", async () => {
    const { handlers, ipcMain } = createIpcMain();
    const registry = new CancelableRequestRegistry();
    const event = createEvent();
    const transcribeLocalWhisper = abortableManagerMethod;
    transcribeLocalWhisper.mockClear();
    registerWhisperHandlers(
      { ipcMain },
      {
        whisperManager: { transcribeLocalWhisper },
        cancelableRequests: registry,
        windowManager: createWindowManager(event),
      }
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
        windowManager: createWindowManager(event),
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
