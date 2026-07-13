import { describe, expect, it, vi } from "vitest";

const { registerDebugLoggingHandlers } = require("../ipc/handlers/debugLoggingHandlers");

describe("debug logging IPC handlers", () => {
  it("purges only through the logger-owned cleanup boundary", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }),
    };
    const purgeArtifacts = vi.fn(async () => ({
      success: true,
      filesDeleted: 2,
      bytesDeleted: 128,
      errors: [],
    }));
    const debugLogger = {
      getArtifactLogsDir: () => "C:\\safe\\logs",
      getLogsDir: () => null,
      getLogPath: () => null,
      getLogsDirSource: () => "install",
      isFileLoggingEnabled: () => false,
      getFileLoggingError: () => null,
      isEnabled: () => false,
      getLevel: () => "info",
      purgeArtifacts,
      error: vi.fn(),
    };
    const sender = { mainFrame: {} };
    const senderWindow = { isDestroyed: () => false };
    const dialog = { showMessageBox: vi.fn(async () => ({ response: 1 })) };

    registerDebugLoggingHandlers(
      {
        ipcMain,
        app: { getPath: () => "C:\\fallback" },
        path: require("path"),
        shell: { openPath: vi.fn() },
        dialog,
        BrowserWindow: { fromWebContents: vi.fn(() => senderWindow) },
        debugLogger,
        saveDebugAudioCapture: vi.fn(),
      },
      { environmentManager: {} }
    );

    const handler = handlers.get("purge-debug-artifacts");
    expect(handler).toBeTypeOf("function");
    const result = await handler?.(
      { sender, senderFrame: sender.mainFrame },
      "C:\\untrusted\\renderer-path"
    );

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      senderWindow,
      expect.objectContaining({ buttons: ["Keep Data", "Delete Data"], defaultId: 0, cancelId: 0 })
    );
    expect(purgeArtifacts).toHaveBeenCalledOnce();
    expect(purgeArtifacts).toHaveBeenCalledWith();
    expect(result).toMatchObject({ success: true, filesDeleted: 2, bytesDeleted: 128 });
  });

  it("requires main-process user confirmation before deletion", async () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const ipcMain = {
      handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler),
    };
    const purgeArtifacts = vi.fn();
    const sender = { mainFrame: {} };
    const senderWindow = { isDestroyed: () => false };
    registerDebugLoggingHandlers(
      {
        ipcMain,
        app: { getPath: () => "C:\\fallback" },
        path: require("path"),
        shell: { openPath: vi.fn() },
        dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
        BrowserWindow: { fromWebContents: () => senderWindow },
        debugLogger: {
          purgeArtifacts,
          error: vi.fn(),
        },
        saveDebugAudioCapture: vi.fn(),
      },
      { environmentManager: {} }
    );

    const result = await handlers.get("purge-debug-artifacts")?.({
      sender,
      senderFrame: sender.mainFrame,
    });

    expect(result).toMatchObject({ success: false, cancelled: true });
    expect(purgeArtifacts).not.toHaveBeenCalled();
  });
});
