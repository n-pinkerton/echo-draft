import { describe, expect, it, vi } from "vitest";

import { registerMobileInboxHandlers } from "./mobileInboxHandlers.js";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";

function createHarness() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const controlSender: any = {
    getURL: () => "file:///app/index.html?view=control-panel",
  };
  controlSender.mainFrame = { processId: 1, routingId: 1, url: controlSender.getURL() };
  const dictationSender: any = { getURL: () => "file:///app/index.html" };
  dictationSender.mainFrame = { processId: 2, routingId: 2, url: dictationSender.getURL() };
  const mobileInboxManager = {
    completeRequest: vi.fn(() => ({ success: true })),
    getStatus: vi.fn(() => ({ configured: false, folderPath: null, state: "not_configured" })),
    setInboxPath: vi.fn(async (folderPath) => ({
      configured: true,
      folderPath,
      state: "waiting",
    })),
    markRendererReady: vi.fn(() => ({ success: true })),
  };
  const dialog = {
    showOpenDialog: vi.fn(async () => ({
      canceled: false,
      filePaths: ["C:/OneDrive/EchoDraft Mobile"],
    })),
  };
  const windowManager = {
    controlPanelWindow: {
      __echoDraftTrustedUrl: controlSender.getURL(),
      webContents: controlSender,
      isDestroyed: () => false,
    },
    mainWindow: {
      __echoDraftTrustedUrl: dictationSender.getURL(),
      webContents: dictationSender,
      isDestroyed: () => false,
    },
  };
  registerMobileInboxHandlers(
    {
      ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) },
      BrowserWindow: { getFocusedWindow: vi.fn() },
      dialog,
    } as any,
    { mobileInboxManager, windowManager } as any
  );
  return {
    controlEvent: { sender: controlSender, senderFrame: controlSender.mainFrame },
    dictationEvent: { sender: dictationSender, senderFrame: dictationSender.mainFrame },
    dialog,
    handlers,
    mobileInboxManager,
  };
}

describe("mobile inbox IPC", () => {
  it("lets only the control panel choose and inspect the sync folder", async () => {
    const harness = createHarness();

    await expect(
      harness.handlers.get("mobile-inbox-get-status")?.(harness.controlEvent)
    ).resolves.toMatchObject({ configured: false });
    await expect(
      harness.handlers.get("mobile-inbox-choose-folder")?.(harness.controlEvent)
    ).resolves.toMatchObject({ success: true, status: { configured: true } });
    expect(harness.mobileInboxManager.setInboxPath).toHaveBeenCalledWith(
      "C:/OneDrive/EchoDraft Mobile"
    );

    await expect(
      harness.handlers.get("mobile-inbox-get-status")?.(harness.dictationEvent)
    ).rejects.toMatchObject({ code: "UNTRUSTED_RENDERER" });
  });

  it("accepts a bounded dictation result while dropping an invalid optional title", async () => {
    const harness = createHarness();

    await harness.handlers.get("mobile-inbox-complete")?.(
      harness.dictationEvent,
      REQUEST_ID.toUpperCase(),
      {
        success: true,
        title: "x".repeat(500),
        text: "Cleaned memo",
        rawText: "raw memo",
        source: "openai",
        cleanup: { requested: true, status: "applied" },
      }
    );

    expect(harness.mobileInboxManager.completeRequest).toHaveBeenCalledWith(REQUEST_ID, {
      success: true,
      text: "Cleaned memo",
      rawText: "raw memo",
      source: "openai",
      cleanup: { requested: true, status: "applied" },
    });
  });

  it("rejects untrusted, malformed, and oversized completions", async () => {
    const harness = createHarness();
    const handler = harness.handlers.get("mobile-inbox-complete")!;

    await expect(
      handler(harness.controlEvent, REQUEST_ID, { success: false })
    ).rejects.toMatchObject({ code: "UNTRUSTED_RENDERER" });
    await expect(
      handler(harness.dictationEvent, "not-a-request", { success: false })
    ).rejects.toThrow(/request id/i);
    await expect(
      handler(harness.dictationEvent, REQUEST_ID, {
        success: true,
        text: "x".repeat(20_001),
      })
    ).rejects.toThrow(/completion text/i);
    expect(harness.mobileInboxManager.completeRequest).not.toHaveBeenCalled();
  });

  it("accepts the readiness handshake only from the dictation renderer", async () => {
    const harness = createHarness();
    const handler = harness.handlers.get("mobile-inbox-renderer-ready")!;

    await expect(handler(harness.dictationEvent)).resolves.toEqual({ success: true });
    expect(harness.mobileInboxManager.markRendererReady).toHaveBeenCalledOnce();
    await expect(handler(harness.controlEvent)).rejects.toMatchObject({
      code: "UNTRUSTED_RENDERER",
    });
  });
});
