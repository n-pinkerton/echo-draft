import { describe, expect, it, vi } from "vitest";

import { registerTranscriptionDbHandlers } from "./transcriptionDbHandlers.js";

function createHarness() {
  const handlers = new Map<string, (...args: any[]) => any>();
  const sender: any = {
    id: 8,
    getURL: () => "file:///app/index.html?view=control-panel",
  };
  sender.mainFrame = { processId: 1, routingId: 1, url: sender.getURL() };
  const databaseManager = {
    getPendingTodos: vi.fn(() => []),
    markTodoActioned: vi.fn(() => ({ success: true })),
  };

  registerTranscriptionDbHandlers(
    {
      ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) },
      app: { getPath: vi.fn() },
      BrowserWindow: { getFocusedWindow: vi.fn() },
      dialog: { showSaveDialog: vi.fn() },
      fs: {},
      path: {},
    } as any,
    {
      databaseManager,
      broadcastToWindows: vi.fn(),
      windowManager: {
        controlPanelWindow: {
          __echoDraftTrustedUrl: sender.getURL(),
          webContents: sender,
          isDestroyed: () => false,
        },
      },
    } as any
  );

  return {
    databaseManager,
    event: { sender, senderFrame: sender.mainFrame },
    handlers,
  };
}

describe("To Do database IPC", () => {
  it("clamps list limits and marks a valid item as actioned", async () => {
    const harness = createHarness();

    await harness.handlers.get("db-get-pending-todos")?.(harness.event, 5_000);
    expect(harness.databaseManager.getPendingTodos).toHaveBeenCalledWith(100);

    await harness.handlers.get("db-mark-todo-actioned")?.(harness.event, 12);
    expect(harness.databaseManager.markTodoActioned).toHaveBeenCalledWith(12);
  });

  it.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid action ID %s",
    async (id) => {
      const harness = createHarness();
      await expect(
        harness.handlers.get("db-mark-todo-actioned")?.(harness.event, id)
      ).rejects.toThrow(/invalid to do id/i);
      expect(harness.databaseManager.markTodoActioned).not.toHaveBeenCalled();
    }
  );

  it("rejects an untrusted renderer", async () => {
    const harness = createHarness();
    const untrusted = {
      sender: harness.event.sender,
      senderFrame: { processId: 1, routingId: 2, url: harness.event.sender.getURL() },
    };

    await expect(
      harness.handlers.get("db-get-pending-todos")?.(untrusted, 25)
    ).rejects.toMatchObject({ code: "UNTRUSTED_RENDERER" });
    expect(harness.databaseManager.getPendingTodos).not.toHaveBeenCalled();
  });
});
