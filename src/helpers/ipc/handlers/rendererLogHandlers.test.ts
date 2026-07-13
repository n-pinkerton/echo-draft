import { describe, expect, it, vi } from "vitest";

import { registerRendererLogHandlers } from "./rendererLogHandlers.js";

const createHarness = () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const frame = { url: "file:///app/index.html?view=dictation" };
  const sender = { mainFrame: frame, getURL: () => frame.url };
  const controlFrame = { url: "file:///app/index.html?view=control-panel" };
  const controlSender = { mainFrame: controlFrame, getURL: () => controlFrame.url };
  registerRendererLogHandlers(
    {
      ipcMain: {
        handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
          handlers.set(channel, handler);
        }),
      },
    } as any,
    {
      windowManager: {
        mainWindow: {
          __echoDraftTrustedUrl: frame.url,
          webContents: sender,
          isDestroyed: () => false,
        },
        controlPanelWindow: {
          __echoDraftTrustedUrl: controlFrame.url,
          webContents: controlSender,
          isDestroyed: () => false,
        },
      },
    } as any
  );
  return {
    event: { sender, senderFrame: frame },
    controlEvent: { sender: controlSender, senderFrame: controlFrame },
    handlers,
  };
};

describe("renderer log IPC", () => {
  it("rejects oversized metadata even when the message itself is short", async () => {
    const { event, handlers } = createHarness();
    const invoke = handlers.get("app-log")!;
    await expect(
      invoke(event, { level: "info", message: "short", metadata: "x".repeat(129 * 1024) })
    ).rejects.toThrow("too large");
  });

  it("rejects cyclic renderer metadata", async () => {
    const { event, handlers } = createHarness();
    const entry: any = { level: "info", message: "short" };
    entry.metadata = entry;
    await expect(handlers.get("app-log")!(event, entry)).rejects.toThrow("serializable");
  });

  it("rate limits a trusted renderer that floods the main-process log", async () => {
    const { event, handlers } = createHarness();
    const invoke = handlers.get("app-log")!;

    for (let index = 0; index < 200; index += 1) {
      await expect(invoke(event, { level: "trace", message: `entry-${index}` })).resolves.toEqual({
        success: true,
      });
    }
    await expect(invoke(event, { level: "trace", message: "one-too-many" })).rejects.toThrow(
      "rate limited"
    );
  });

  it("applies one aggregate budget across all trusted renderer windows", async () => {
    const { event, controlEvent, handlers } = createHarness();
    const invoke = handlers.get("app-log")!;

    for (let index = 0; index < 150; index += 1) {
      await invoke(event, { level: "trace", message: `dictation-${index}` });
      await invoke(controlEvent, { level: "trace", message: `control-${index}` });
    }

    await expect(invoke(event, { level: "trace", message: "aggregate-overflow" })).rejects.toThrow(
      "rate limited"
    );
  });
});
