import { describe, expect, it, vi } from "vitest";

import { registerAssemblyAiStreamingHandlers } from "./assemblyAiStreamingHandlers.js";

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
    } as any
  );

  return {
    invokeStop: () => handlers.get("assemblyai-streaming-stop")?.(),
    streamingState,
  };
};

describe("AssemblyAI streaming stop IPC", () => {
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
});
