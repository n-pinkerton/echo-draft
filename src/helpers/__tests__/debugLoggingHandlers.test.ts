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

    registerDebugLoggingHandlers(
      {
        ipcMain,
        app: { getPath: () => "C:\\fallback" },
        path: require("path"),
        shell: { openPath: vi.fn() },
        debugLogger,
        saveDebugAudioCapture: vi.fn(),
      },
      { environmentManager: {} }
    );

    const handler = handlers.get("purge-debug-artifacts");
    expect(handler).toBeTypeOf("function");
    const result = await handler?.({}, "C:\\untrusted\\renderer-path");

    expect(purgeArtifacts).toHaveBeenCalledOnce();
    expect(purgeArtifacts).toHaveBeenCalledWith();
    expect(result).toMatchObject({ success: true, filesDeleted: 2, bytesDeleted: 128 });
  });
});
