import { afterEach, describe, expect, it, vi } from "vitest";

const { registerDebugLoggingHandlers } = require("../ipc/handlers/debugLoggingHandlers");

const originalLogLevel = process.env.OPENWHISPR_LOG_LEVEL;

afterEach(() => {
  if (originalLogLevel === undefined) delete process.env.OPENWHISPR_LOG_LEVEL;
  else process.env.OPENWHISPR_LOG_LEVEL = originalLogLevel;
});

const createHarness = ({ enabled = false, dialogResponse = 0 } = {}) => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  };
  const sender = { mainFrame: {} as object };
  const senderWindow = {
    webContents: sender,
    isDestroyed: () => false,
  };
  let appliedLevel = enabled ? "debug" : "info";
  const saveDebugLogLevel = vi.fn((level: string) => {
    appliedLevel = level;
    return { saveAllKeysResult: { success: true } };
  });
  const purgeArtifacts = vi.fn(async () => ({
    success: true,
    filesDeleted: 2,
    bytesDeleted: 128,
    errors: [],
    freshLogStarted: appliedLevel === "debug",
  }));
  const debugLogger = {
    getArtifactLogsDir: () => "C:\\safe\\logs",
    getLogsDir: () => null,
    getLogPath: () => null,
    getLogsDirSource: () => "install",
    isFileLoggingEnabled: () => appliedLevel === "debug",
    getFileLoggingError: () => null,
    isEnabled: () => appliedLevel === "debug",
    getLevel: () => appliedLevel,
    refreshLogLevel: vi.fn(),
    ensureFileLogging: vi.fn(),
    purgeArtifacts,
    error: vi.fn(),
  };
  const dialog = { showMessageBox: vi.fn(async () => ({ response: dialogResponse })) };

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
    {
      environmentManager: { saveDebugLogLevel },
      windowManager: { controlPanelWindow: senderWindow },
    }
  );

  return {
    debugLogger,
    dialog,
    event: { sender, senderFrame: sender.mainFrame },
    handlers,
    purgeArtifacts,
    saveDebugLogLevel,
    sender,
    senderWindow,
  };
};

describe("debug logging IPC handlers", () => {
  it("requires the live control-panel main frame before changing debug state", async () => {
    const harness = createHarness({ dialogResponse: 1 });
    const unauthorizedSender = { mainFrame: {} };

    const result = await harness.handlers.get("set-debug-logging")?.(
      { sender: unauthorizedSender, senderFrame: unauthorizedSender.mainFrame },
      true
    );

    expect(result).toMatchObject({ success: false });
    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(harness.saveDebugLogLevel).not.toHaveBeenCalled();
  });

  it("rejects debug enablement from a subframe", async () => {
    const harness = createHarness({ dialogResponse: 1 });

    const result = await harness.handlers.get("set-debug-logging")?.(
      { sender: harness.sender, senderFrame: {} },
      true
    );

    expect(result).toMatchObject({ success: false });
    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(harness.saveDebugLogLevel).not.toHaveBeenCalled();
  });

  it("requires native main-process confirmation before enabling sensitive capture", async () => {
    const harness = createHarness({ dialogResponse: 0 });

    const result = await harness.handlers.get("set-debug-logging")?.(harness.event, true);

    expect(harness.dialog.showMessageBox).toHaveBeenCalledWith(
      harness.senderWindow,
      expect.objectContaining({
        buttons: ["Cancel", "Enable Debug Mode"],
        defaultId: 0,
        cancelId: 0,
        detail: expect.stringMatching(/dictated text.*recordings containing your voice/i),
      })
    );
    expect(result).toMatchObject({ success: false, cancelled: true, enabled: false });
    expect(harness.saveDebugLogLevel).not.toHaveBeenCalled();
  });

  it("persists debug enablement only after native confirmation", async () => {
    const harness = createHarness({ dialogResponse: 1 });

    const result = await harness.handlers.get("set-debug-logging")?.(harness.event, true);

    expect(harness.saveDebugLogLevel).toHaveBeenCalledWith("debug");
    expect(result).toMatchObject({ success: true, enabled: true, logLevel: "debug" });
  });

  it("offers to turn off debug mode before deletion and honors that choice", async () => {
    const harness = createHarness({ enabled: true, dialogResponse: 1 });

    const result = await harness.handlers.get("purge-debug-artifacts")?.(harness.event);

    expect(harness.dialog.showMessageBox).toHaveBeenCalledWith(
      harness.senderWindow,
      expect.objectContaining({
        buttons: ["Cancel", "Turn Off and Delete", "Delete; Keep Logging"],
        defaultId: 0,
        cancelId: 0,
        detail: expect.stringContaining("start a fresh log immediately"),
      })
    );
    expect(harness.saveDebugLogLevel).toHaveBeenCalledWith("info");
    expect(harness.purgeArtifacts).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, debugEnabled: false });
  });

  it("can delete while keeping debug logging enabled", async () => {
    const harness = createHarness({ enabled: true, dialogResponse: 2 });

    const result = await harness.handlers.get("purge-debug-artifacts")?.(harness.event);

    expect(harness.saveDebugLogLevel).not.toHaveBeenCalled();
    expect(harness.purgeArtifacts).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, debugEnabled: true, freshLogStarted: true });
  });
});
