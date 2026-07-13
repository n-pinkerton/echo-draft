import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const autoUpdaterMocks = vi.hoisted(() => ({
  setFeedURL: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  autoDownload: true,
  autoInstallOnAppQuit: true,
  logger: null as unknown,
}));

const UpdateManager = require("./updater.js");
const { getGithubUpdateConfig } = require("./updater.js");
const { areAutomaticUpdatesTrusted } = require("./config/updateTrust.js");

describe("Windows update trust boundary", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.OPENWHISPR_UPDATE_OWNER;
    delete process.env.OPENWHISPR_UPDATE_REPO;
  });

  it("requires both signed-build configuration and a pinned publisher on Windows", () => {
    expect(areAutomaticUpdatesTrusted({ platform: "win32" })).toBe(false);
    expect(
      areAutomaticUpdatesTrusted({
        platform: "win32",
        windowsCodeSigningEnabled: true,
        windowsPublishers: [],
      })
    ).toBe(false);
    expect(
      areAutomaticUpdatesTrusted({
        platform: "win32",
        windowsCodeSigningEnabled: false,
        windowsPublishers: ["EchoDraft Limited"],
      })
    ).toBe(false);
    expect(
      areAutomaticUpdatesTrusted({
        platform: "win32",
        windowsCodeSigningEnabled: true,
        windowsPublishers: ["EchoDraft Limited"],
      })
    ).toBe(true);
  });

  it("disables automatic Linux installation and ignores feed identity overrides", async () => {
    process.env.OPENWHISPR_UPDATE_OWNER = "attacker";
    process.env.OPENWHISPR_UPDATE_REPO = "malicious-feed";
    const manager = new UpdateManager({ platform: "linux", updater: autoUpdaterMocks });

    expect(getGithubUpdateConfig()).toEqual({
      provider: "github",
      owner: "n-pinkerton",
      repo: "echo-draft",
      private: false,
    });
    expect(autoUpdaterMocks.setFeedURL).not.toHaveBeenCalled();
    await expect(manager.checkForUpdates()).resolves.toMatchObject({
      updateAvailable: false,
      message: expect.stringMatching(/independently signed update verification/i),
    });
  });

  it("resolves live windows at notification time after control-panel recreation", () => {
    const manager = new UpdateManager({ platform: "darwin", updater: autoUpdaterMocks });
    const firstSend = vi.fn();
    const replacementSend = vi.fn();
    let controlPanelWindow: any = {
      isDestroyed: () => false,
      webContents: { send: firstSend },
    };
    manager.setWindowProvider(() => ({ mainWindow: null, controlPanelWindow }));

    manager.notifyRenderers("checking-for-update");
    controlPanelWindow = {
      isDestroyed: () => false,
      webContents: { send: replacementSend },
    };
    manager.notifyRenderers("update-available", { version: "2.0.0" });

    expect(firstSend).toHaveBeenCalledOnce();
    expect(replacementSend).toHaveBeenCalledWith("update-available", { version: "2.0.0" });
    manager.cleanup();
  });

  it("does not fall back to a cached window after the live window closes", () => {
    const manager = new UpdateManager({ platform: "darwin", updater: autoUpdaterMocks });
    const staleSend = vi.fn();
    let controlPanelWindow: any = null;

    manager.setWindows(null, {
      isDestroyed: () => false,
      webContents: { send: staleSend },
    });
    manager.setWindowProvider(() => ({ mainWindow: null, controlPanelWindow }));

    manager.notifyRenderers("update-available", { version: "2.0.0" });

    expect(staleSend).not.toHaveBeenCalled();
    manager.cleanup();
  });

  it("never contacts, downloads, or installs through the updater in this unsigned build", async () => {
    const manager = new UpdateManager({ platform: "win32", updater: autoUpdaterMocks });

    expect(autoUpdaterMocks.setFeedURL).not.toHaveBeenCalled();
    await expect(manager.checkForUpdates()).resolves.toMatchObject({ updateAvailable: false });
    await expect(manager.downloadUpdate()).resolves.toMatchObject({ success: false });
    manager.updateDownloaded = true;
    await expect(manager.installUpdate()).resolves.toMatchObject({ success: false });
    manager.checkForUpdatesOnStartup();

    expect(autoUpdaterMocks.checkForUpdates).not.toHaveBeenCalled();
    expect(autoUpdaterMocks.downloadUpdate).not.toHaveBeenCalled();
    expect(autoUpdaterMocks.quitAndInstall).not.toHaveBeenCalled();
    await expect(manager.getUpdateStatus()).resolves.toMatchObject({
      updatesEnabled: false,
      hasCheckedForUpdates: false,
      isChecking: false,
      disabledReason: expect.stringMatching(/unsigned Windows build/i),
    });
  });

  it("distinguishes startup delay, in-flight checking, and a completed check", async () => {
    vi.useFakeTimers();
    let resolveCheck!: (value: { isUpdateAvailable: boolean }) => void;
    autoUpdaterMocks.checkForUpdates.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve;
        })
    );
    const manager = new UpdateManager({ platform: "win32", updater: autoUpdaterMocks });
    manager.updatesTrusted = true;
    manager.setupAutoUpdater();

    manager.checkForUpdatesOnStartup();
    await expect(manager.getUpdateStatus()).resolves.toMatchObject({
      updatesEnabled: true,
      hasCheckedForUpdates: false,
      isChecking: false,
    });

    await vi.advanceTimersByTimeAsync(3000);
    await expect(manager.getUpdateStatus()).resolves.toMatchObject({
      hasCheckedForUpdates: false,
      isChecking: true,
    });

    resolveCheck({ isUpdateAvailable: false });
    await vi.waitFor(async () => {
      await expect(manager.getUpdateStatus()).resolves.toMatchObject({
        hasCheckedForUpdates: true,
        isChecking: false,
        updateAvailable: false,
      });
    });
    manager.cleanup();
  });

  it("notifies one updater error and clears checking when the check promise rejects", async () => {
    const error = new Error("update endpoint unavailable");
    autoUpdaterMocks.checkForUpdates.mockRejectedValueOnce(error);
    const manager = new UpdateManager({ platform: "darwin", updater: autoUpdaterMocks });
    const send = vi.fn();
    manager.setWindows({ isDestroyed: () => false, webContents: { send } }, null);

    await expect(manager.checkForUpdates()).rejects.toBe(error);

    expect(send.mock.calls.filter(([channel]) => channel === "update-error")).toHaveLength(1);
    await expect(manager.getUpdateStatus()).resolves.toMatchObject({
      hasCheckedForUpdates: false,
      isChecking: false,
    });

    autoUpdaterMocks.checkForUpdates.mockResolvedValueOnce({ isUpdateAvailable: false });
    await expect(manager.checkForUpdates()).resolves.toMatchObject({ updateAvailable: false });
    expect(autoUpdaterMocks.checkForUpdates).toHaveBeenCalledTimes(2);
    manager.cleanup();
  });

  it("deduplicates an updater error event and the matching rejected check", async () => {
    const error = new Error("shared updater failure");
    let emitUpdaterError!: (error: Error) => void;
    autoUpdaterMocks.checkForUpdates.mockImplementationOnce(async () => {
      emitUpdaterError(error);
      throw error;
    });
    const manager = new UpdateManager({ platform: "darwin", updater: autoUpdaterMocks });
    emitUpdaterError = autoUpdaterMocks.on.mock.calls.find(([event]) => event === "error")?.[1];
    expect(emitUpdaterError).toBeTypeOf("function");
    const send = vi.fn();
    manager.setWindows({ isDestroyed: () => false, webContents: { send } }, null);

    await expect(manager.checkForUpdates()).rejects.toBe(error);

    expect(send.mock.calls.filter(([channel]) => channel === "update-error")).toHaveLength(1);
    await expect(manager.getUpdateStatus()).resolves.toMatchObject({ isChecking: false });
    manager.cleanup();
  });

  it("shares an in-flight startup check with an overlapping manual check", async () => {
    vi.useFakeTimers();
    let resolveCheck!: (value: { isUpdateAvailable: boolean }) => void;
    autoUpdaterMocks.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve;
        })
    );
    const manager = new UpdateManager({ platform: "darwin", updater: autoUpdaterMocks });
    const send = vi.fn();
    manager.setWindows({ isDestroyed: () => false, webContents: { send } }, null);

    manager.checkForUpdatesOnStartup();
    await vi.advanceTimersByTimeAsync(3000);
    const manualCheck = manager.checkForUpdates();

    expect(autoUpdaterMocks.checkForUpdates).toHaveBeenCalledOnce();
    await expect(manager.getUpdateStatus()).resolves.toMatchObject({
      hasCheckedForUpdates: false,
      isChecking: true,
    });
    expect(send).not.toHaveBeenCalledWith("update-not-available", expect.anything());

    resolveCheck({ isUpdateAvailable: false });
    await expect(manualCheck).resolves.toMatchObject({ updateAvailable: false });
    expect(send.mock.calls.filter(([channel]) => channel === "update-not-available")).toHaveLength(
      1
    );
    manager.cleanup();
  });
});
