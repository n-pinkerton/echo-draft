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
  const sender: any = {
    getURL: () => "file:///app/index.html?view=control-panel",
  };
  sender.mainFrame = { url: sender.getURL() };
  const senderWindow = {
    __echoDraftTrustedUrl: sender.getURL(),
    webContents: sender,
    isDestroyed: () => false,
  };
  const dictationSender: any = {
    getURL: () => "file:///app/index.html?view=dictation",
  };
  dictationSender.mainFrame = { url: dictationSender.getURL() };
  const dictationWindow = {
    __echoDraftTrustedUrl: dictationSender.getURL(),
    webContents: dictationSender,
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
    debug: vi.fn(),
    error: vi.fn(),
  };
  const dialog = { showMessageBox: vi.fn(async () => ({ response: dialogResponse })) };
  const saveDebugAudioCapture = vi.fn(async () => ({
    filePath: "C:\\safe\\logs\\audio\\capture.webm",
    audioDir: "C:\\safe\\logs\\audio",
    bytes: 4,
    kept: 1,
    deleted: 0,
    bytesKept: 400,
    bytesDeleted: 0,
  }));
  const claimedDebugSessions = new Set<string>();
  const setDebugConsent = vi.fn();

  registerDebugLoggingHandlers(
    {
      ipcMain,
      app: { getPath: () => "C:\\fallback" },
      path: require("path"),
      shell: { openPath: vi.fn() },
      dialog,
      BrowserWindow: { fromWebContents: vi.fn(() => senderWindow) },
      debugLogger,
      saveDebugAudioCapture,
    },
    {
      environmentManager: { saveDebugLogLevel, setDebugConsent },
      windowManager: {
        controlPanelWindow: senderWindow,
        mainWindow: dictationWindow,
        isIssuedDictationSession: (sessionId: string) =>
          sessionId === "session-1" || sessionId === "session-2",
        claimDebugAudioSession: (sessionId: string) => {
          if (
            (sessionId !== "session-1" && sessionId !== "session-2") ||
            claimedDebugSessions.has(sessionId)
          )
            return false;
          claimedDebugSessions.add(sessionId);
          return true;
        },
      },
    }
  );

  return {
    debugLogger,
    dialog,
    dictationEvent: { sender: dictationSender, senderFrame: dictationSender.mainFrame },
    event: { sender, senderFrame: sender.mainFrame },
    handlers,
    purgeArtifacts,
    saveDebugLogLevel,
    setDebugConsent,
    saveDebugAudioCapture,
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
    expect(harness.setDebugConsent).toHaveBeenCalledWith(true);
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

  it("accepts bounded audio only from an issued dictation session and hides local paths", async () => {
    const harness = createHarness({ enabled: true });
    const result = await harness.handlers.get("debug-save-audio")?.(harness.dictationEvent, {
      audioBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
      mimeType: "audio/webm;codecs=opus",
      sessionId: "session-1",
      outputMode: "insert",
      durationSeconds: 1.5,
    });

    expect(harness.saveDebugAudioCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "audio/webm",
        sessionId: "session-1",
        outputMode: "insert",
      })
    );
    expect(result).toMatchObject({ success: true, bytes: 4, kept: 1 });
    expect(result).not.toHaveProperty("filePath");
    expect(result).not.toHaveProperty("audioDir");
  });

  it("serializes capture and purge from admission through confirmation and residual cleanup", async () => {
    const harness = createHarness({ enabled: true, dialogResponse: 2 });
    let releaseFirstCapture: (() => void) | null = null;
    const firstCaptureGate = new Promise<void>((resolve) => {
      releaseFirstCapture = resolve;
    });
    const savedResult = {
      filePath: "C:\\safe\\logs\\audio\\capture.webm",
      audioDir: "C:\\safe\\logs\\audio",
      bytes: 4,
      kept: 1,
      deleted: 0,
      bytesKept: 4,
      bytesDeleted: 0,
    };
    harness.saveDebugAudioCapture
      .mockImplementationOnce(async () => {
        await firstCaptureGate;
        return savedResult;
      })
      .mockResolvedValueOnce(savedResult);

    const makePayload = (sessionId: string) => ({
      audioBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
      mimeType: "audio/webm",
      sessionId,
      outputMode: "insert",
    });
    const firstCapture = harness.handlers.get("debug-save-audio")?.(
      harness.dictationEvent,
      makePayload("session-1")
    );
    await vi.waitFor(() => expect(harness.saveDebugAudioCapture).toHaveBeenCalledTimes(1));

    const purge = harness.handlers.get("purge-debug-artifacts")?.(harness.event);
    const secondCapture = harness.handlers.get("debug-save-audio")?.(
      harness.dictationEvent,
      makePayload("session-2")
    );
    await Promise.resolve();
    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(harness.saveDebugAudioCapture).toHaveBeenCalledTimes(1);

    releaseFirstCapture?.();
    await expect(firstCapture).resolves.toMatchObject({ success: true });
    await vi.waitFor(() => expect(harness.dialog.showMessageBox).toHaveBeenCalledOnce());
    await expect(purge).resolves.toMatchObject({ success: true });
    await expect(secondCapture).resolves.toMatchObject({ success: true });
    expect(harness.purgeArtifacts).toHaveBeenCalledOnce();
    expect(harness.saveDebugAudioCapture).toHaveBeenCalledTimes(2);
    expect(harness.purgeArtifacts.mock.invocationCallOrder[0]).toBeLessThan(
      harness.saveDebugAudioCapture.mock.invocationCallOrder[1]
    );
  });

  it("exposes no diagnostic paths to the dictation renderer and consumes capture sessions once", async () => {
    const harness = createHarness({ enabled: true });
    const state = await harness.handlers.get("get-debug-state")?.(harness.dictationEvent);
    expect(state).toMatchObject({ enabled: true, logPath: null, logsDir: null });

    const payload = {
      audioBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
      mimeType: "audio/webm",
      sessionId: "session-1",
      outputMode: "insert",
    };
    await expect(
      harness.handlers.get("debug-save-audio")?.(harness.dictationEvent, payload)
    ).resolves.toMatchObject({
      success: true,
    });
    await expect(
      harness.handlers.get("debug-save-audio")?.(harness.dictationEvent, payload)
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/already used/i),
    });
    expect(harness.saveDebugAudioCapture).toHaveBeenCalledOnce();
  });

  it("rejects unissued, untrusted, and oversized debug audio before writing", async () => {
    const harness = createHarness({ enabled: true });
    await expect(
      harness.handlers.get("debug-save-audio")?.(harness.event, {
        audioBuffer: new Uint8Array([1]).buffer,
        mimeType: "audio/webm",
        sessionId: "session-1",
      })
    ).rejects.toMatchObject({ code: "UNTRUSTED_RENDERER" });

    const unissued = await harness.handlers.get("debug-save-audio")?.(harness.dictationEvent, {
      audioBuffer: new Uint8Array([1]).buffer,
      mimeType: "audio/webm",
      sessionId: "forged-session",
    });
    expect(unissued).toMatchObject({ success: false, error: expect.stringMatching(/session/i) });

    const oversized = await harness.handlers.get("debug-save-audio")?.(harness.dictationEvent, {
      audioBuffer: { byteLength: 65 * 1024 * 1024 },
      mimeType: "audio/webm",
      sessionId: "session-1",
    });
    expect(oversized).toMatchObject({ success: false, error: expect.stringMatching(/size/i) });
    expect(harness.saveDebugAudioCapture).not.toHaveBeenCalled();
  });
});
