import { afterEach, describe, expect, it, vi } from "vitest";

const { registerDebugLoggingHandlers } = require("../ipc/handlers/debugLoggingHandlers");

const originalLogLevel = process.env.OPENWHISPR_LOG_LEVEL;

afterEach(() => {
  if (originalLogLevel === undefined) delete process.env.OPENWHISPR_LOG_LEVEL;
  else process.env.OPENWHISPR_LOG_LEVEL = originalLogLevel;
});

const createHarness = ({
  enabled = false,
  dialogResponse = 0,
  dialogResponses,
}: {
  enabled?: boolean;
  dialogResponse?: number;
  dialogResponses?: number[];
} = {}) => {
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
  const queuedDialogResponses = dialogResponses ? [...dialogResponses] : null;
  const dialog = {
    showMessageBox: vi.fn(async () => ({
      response: queuedDialogResponses?.length ? queuedDialogResponses.shift() : dialogResponse,
    })),
  };
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
  const retentionManifest = {
    version: 1,
    cutoffIso: "2026-07-10T12:00:00.000Z",
    summary: {
      history: 3,
      todos: 5,
      pendingTodos: 2,
      actionedTodos: 3,
      alternatives: 2,
      correctionFlags: 1,
      logFiles: 4,
      logBytes: 512,
    },
  };
  const createRetentionManifest = vi.fn(async () => retentionManifest);
  const executeRetentionManifest = vi.fn(async () => ({
    success: true,
    aborted: false,
    cutoffIso: retentionManifest.cutoffIso,
    database: { success: true, historyDeleted: 3, todosDeleted: 5 },
    logs: { success: true, filesDeleted: 4, bytesDeleted: 512, residualFiles: 0 },
    errors: [],
  }));
  const broadcastToWindows = vi.fn();
  const trayManager = { updateTrayMenu: vi.fn() };

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
      createRetentionManifest,
      executeRetentionManifest,
    },
    {
      broadcastToWindows,
      databaseManager: {},
      environmentManager: { saveDebugLogLevel, setDebugConsent },
      trayManager,
      windowManager: {
        controlPanelWindow: senderWindow,
        mainWindow: dictationWindow,
        isIssuedDictationSession: (sessionId: string) => /^session-\d+$/.test(sessionId),
        claimDebugAudioSession: (sessionId: string) => {
          if (!/^session-\d+$/.test(sessionId) || claimedDebugSessions.has(sessionId)) return false;
          claimedDebugSessions.add(sessionId);
          return true;
        },
      },
    }
  );

  return {
    broadcastToWindows,
    debugLogger,
    createRetentionManifest,
    dialog,
    dictationEvent: { sender: dictationSender, senderFrame: dictationSender.mainFrame },
    event: { sender, senderFrame: sender.mainFrame },
    handlers,
    purgeArtifacts,
    executeRetentionManifest,
    saveDebugLogLevel,
    setDebugConsent,
    saveDebugAudioCapture,
    trayManager,
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

  it("shows immutable 30-day scope and requires two cancel-default confirmations", async () => {
    const harness = createHarness({ dialogResponses: [1, 1] });

    const result = await harness.handlers.get("purge-data-older-than-30-days")?.(harness.event);

    expect(harness.dialog.showMessageBox).toHaveBeenCalledTimes(2);
    expect(harness.dialog.showMessageBox).toHaveBeenNthCalledWith(
      1,
      harness.senderWindow,
      expect.objectContaining({
        title: "Delete logs and transcripts older than 30 days?",
        buttons: ["Cancel", "Continue"],
        defaultId: 0,
        cancelId: 0,
        detail: expect.stringMatching(
          /3 History items.*5 To Dos.*2 pending, 3 actioned.*captured audio.*mobile inbox data.*permanent/is
        ),
      })
    );
    expect(harness.dialog.showMessageBox).toHaveBeenNthCalledWith(
      2,
      harness.senderWindow,
      expect.objectContaining({
        buttons: ["Cancel", "Permanently Delete"],
        defaultId: 0,
        cancelId: 0,
        detail: expect.stringMatching(
          /2026-07-10T12:00:00\.000Z.*rechecks the whole preview.*partial filesystem failure/is
        ),
      })
    );
    expect(harness.createRetentionManifest).toHaveBeenCalledOnce();
    expect(harness.executeRetentionManifest).toHaveBeenCalledOnce();
    expect(harness.broadcastToWindows).toHaveBeenCalledWith("retention-data-changed", {
      reason: "retention",
    });
    expect(harness.trayManager.updateTrayMenu).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      success: true,
      database: { historyDeleted: 3, todosDeleted: 5 },
      logs: { filesDeleted: 4, residualFiles: 0 },
    });
  });

  it("refreshes database consumers after SQLite success with a partial log failure", async () => {
    const harness = createHarness({ dialogResponses: [1, 1] });
    harness.executeRetentionManifest.mockResolvedValueOnce({
      success: false,
      aborted: false,
      cutoffIso: "2026-07-10T12:00:00.000Z",
      database: { success: true, historyDeleted: 3, todosDeleted: 5 },
      logs: {
        success: false,
        filesDeleted: 2,
        bytesDeleted: 256,
        residualFiles: 2,
        errors: ["two logs remain"],
      },
      errors: ["two logs remain"],
    } as any);

    await harness.handlers.get("purge-data-older-than-30-days")?.(harness.event);

    expect(harness.broadcastToWindows).toHaveBeenCalledOnce();
    expect(harness.trayManager.updateTrayMenu).toHaveBeenCalledOnce();
  });

  it("does not refresh database consumers after a safe execution abort", async () => {
    const harness = createHarness({ dialogResponses: [1, 1] });
    harness.executeRetentionManifest.mockResolvedValueOnce({
      success: false,
      aborted: true,
      changed: true,
      cutoffIso: "2026-07-10T12:00:00.000Z",
      database: { success: false, historyDeleted: 0, todosDeleted: 0 },
      logs: { success: false, filesDeleted: 0, bytesDeleted: 0, residualFiles: 0 },
      errors: ["preview changed"],
    } as any);

    await harness.handlers.get("purge-data-older-than-30-days")?.(harness.event);

    expect(harness.broadcastToWindows).not.toHaveBeenCalled();
    expect(harness.trayManager.updateTrayMenu).not.toHaveBeenCalled();
  });

  it("cancels either 30-day confirmation without deleting anything", async () => {
    const firstCancel = createHarness({ dialogResponses: [0] });
    await expect(
      firstCancel.handlers.get("purge-data-older-than-30-days")?.(firstCancel.event)
    ).resolves.toMatchObject({ success: false, cancelled: true });
    expect(firstCancel.executeRetentionManifest).not.toHaveBeenCalled();

    const finalCancel = createHarness({ dialogResponses: [1, 0] });
    await expect(
      finalCancel.handlers.get("purge-data-older-than-30-days")?.(finalCancel.event)
    ).resolves.toMatchObject({ success: false, cancelled: true });
    expect(finalCancel.dialog.showMessageBox).toHaveBeenCalledTimes(2);
    expect(finalCancel.executeRetentionManifest).not.toHaveBeenCalled();
  });

  it("rejects concurrent 30-day deletion requests before a second preview", async () => {
    const harness = createHarness({ dialogResponse: 0 });
    let releasePreview: (() => void) | null = null;
    harness.createRetentionManifest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePreview = () =>
            resolve({
              version: 1,
              cutoffIso: "2026-07-10T12:00:00.000Z",
              summary: {
                history: 0,
                todos: 0,
                pendingTodos: 0,
                actionedTodos: 0,
                alternatives: 0,
                correctionFlags: 0,
                logFiles: 0,
                logBytes: 0,
              },
            });
        })
    );

    const first = harness.handlers.get("purge-data-older-than-30-days")?.(harness.event);
    await vi.waitFor(() => expect(harness.createRetentionManifest).toHaveBeenCalledOnce());
    await expect(
      harness.handlers.get("purge-data-older-than-30-days")?.(harness.event)
    ).resolves.toMatchObject({ success: false, busy: true });
    expect(harness.createRetentionManifest).toHaveBeenCalledOnce();
    releasePreview?.();
    await expect(first).resolves.toMatchObject({ success: false, cancelled: true });
  });

  it("reports a preview failure as safely aborted before any deletion", async () => {
    const harness = createHarness({ dialogResponses: [1, 1] });
    harness.createRetentionManifest.mockRejectedValueOnce(new Error("preview unavailable"));

    await expect(
      harness.handlers.get("purge-data-older-than-30-days")?.(harness.event)
    ).resolves.toMatchObject({
      success: false,
      aborted: true,
      uncertain: false,
      error: "preview unavailable",
    });
    expect(harness.dialog.showMessageBox).not.toHaveBeenCalled();
    expect(harness.executeRetentionManifest).not.toHaveBeenCalled();
    expect(harness.broadcastToWindows).not.toHaveBeenCalled();
    expect(harness.trayManager.updateTrayMenu).not.toHaveBeenCalled();
  });

  it("does not invent zero counts after an unexpected execution exception", async () => {
    const harness = createHarness({ dialogResponses: [1, 1] });
    harness.executeRetentionManifest.mockRejectedValueOnce(new Error("unexpected stop"));

    const result = await harness.handlers.get("purge-data-older-than-30-days")?.(harness.event);

    expect(result).toMatchObject({
      success: false,
      aborted: false,
      uncertain: true,
      error: expect.stringMatching(/could not confirm the complete deletion result/i),
    });
    expect(result).not.toHaveProperty("database");
    expect(result).not.toHaveProperty("logs");
    expect(harness.broadcastToWindows).toHaveBeenCalledOnce();
    expect(harness.trayManager.updateTrayMenu).toHaveBeenCalledOnce();
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

  it("retains bounded audio even when debug logging is disabled", async () => {
    const harness = createHarness({ enabled: false });
    const result = await harness.handlers.get("debug-save-audio")?.(harness.dictationEvent, {
      audioBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
      mimeType: "audio/webm",
      sessionId: "session-1",
      outputMode: "insert",
    });

    expect(harness.saveDebugAudioCapture).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, bytes: 4 });
  });

  it("does not reject ordinary dictation volume because of the old debug rate limit", async () => {
    const harness = createHarness({ enabled: false });
    const completeCaptures = await Promise.all(
      Array.from({ length: 21 }, (_, index) =>
        harness.handlers.get("debug-save-audio")?.(harness.dictationEvent, {
          audioBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
          mimeType: "audio/webm",
          sessionId: `session-${index + 1}`,
          outputMode: "insert",
        })
      )
    );

    expect(completeCaptures.every((result) => result?.success === true)).toBe(true);
    expect(harness.saveDebugAudioCapture).toHaveBeenCalledTimes(21);
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
