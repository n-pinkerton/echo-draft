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
    getArchivedTodos: vi.fn(() => ({ items: [], nextCursor: null })),
    markTodoActioned: vi.fn(() => ({ success: true })),
    saveReprocessingAlternative: vi.fn(() => ({ success: true })),
    getCorrectionRules: vi.fn(() => []),
    saveCorrectionRule: vi.fn(() => ({ success: true, id: 1 })),
    deleteCorrectionRule: vi.fn(() => ({ success: true })),
    getAppStyleProfiles: vi.fn(() => []),
    saveAppStyleProfile: vi.fn(() => ({ success: true, id: 1 })),
    deleteAppStyleProfile: vi.fn(() => ({ success: true })),
    setCorrectionFlag: vi.fn(() => ({ success: true })),
    clearCorrectionFlag: vi.fn(() => ({ success: true })),
  };
  const trayManager = { updateTrayMenu: vi.fn() };

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
      trayManager,
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
    trayManager,
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

  it("returns committed action truth when the optional tray refresh throws", async () => {
    const harness = createHarness();
    harness.trayManager.updateTrayMenu.mockImplementationOnce(() => {
      throw new Error("native tray unavailable");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      harness.handlers.get("db-mark-todo-actioned")?.(harness.event, 12)
    ).resolves.toEqual({ success: true });

    expect(harness.databaseManager.markTodoActioned).toHaveBeenCalledWith(12);
    expect(consoleError).toHaveBeenCalledWith("Failed to refresh the tray after actioning a To Do");
    consoleError.mockRestore();
  });

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

  it("validates Archived paging and forwards a bounded local search", async () => {
    const harness = createHarness();

    await harness.handlers.get("db-get-archived-todos")?.(harness.event, {
      query: "local term",
      cursor: { sortEpoch: 123, id: 9 },
      limit: 25,
    });
    expect(harness.databaseManager.getArchivedTodos).toHaveBeenCalledWith({
      query: "local term",
      cursor: { sortEpoch: 123, id: 9 },
      limit: 25,
    });

    await expect(
      harness.handlers.get("db-get-archived-todos")?.(harness.event, {
        query: "term",
        limit: 101,
      })
    ).rejects.toThrow(/page size/i);
    await expect(
      harness.handlers.get("db-get-archived-todos")?.(harness.event, {
        query: "term",
        unexpected: true,
      })
    ).rejects.toThrow(/unsupported fields/i);
  });

  it("keeps alternatives, rules, profiles, and flags behind the control-panel trust gate", async () => {
    const harness = createHarness();

    await harness.handlers.get("db-save-reprocessing-alternative")?.(harness.event, {
      transcriptionId: 2,
      mode: "cleanup",
      text: "alternative",
    });
    await harness.handlers.get("db-set-correction-flag")?.(harness.event, {
      transcriptionId: 2,
      reason: "cleanup",
    });
    expect(harness.databaseManager.saveReprocessingAlternative).toHaveBeenCalledTimes(1);
    expect(harness.databaseManager.setCorrectionFlag).toHaveBeenCalledTimes(1);

    const untrusted = {
      sender: harness.event.sender,
      senderFrame: { processId: 1, routingId: 2, url: harness.event.sender.getURL() },
    };
    await expect(
      harness.handlers.get("db-get-correction-rules")?.(untrusted)
    ).rejects.toMatchObject({ code: "UNTRUSTED_RENDERER" });
    await expect(
      harness.handlers.get("db-get-app-style-profiles")?.(untrusted)
    ).rejects.toMatchObject({ code: "UNTRUSTED_RENDERER" });
  });
});
