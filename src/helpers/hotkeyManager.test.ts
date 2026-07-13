// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const originalPlatform = process.platform;
const originalDictationKey = process.env.DICTATION_KEY;

async function createManager(platform: "win32" | "darwin" | "linux") {
  vi.resetModules();
  Object.defineProperty(process, "platform", { configurable: true, value: platform });
  delete process.env.DICTATION_KEY;

  vi.doMock("electron", () => ({
    globalShortcut: {
      isRegistered: vi.fn(() => false),
      register: vi.fn(() => true),
      unregister: vi.fn(),
      unregisterAll: vi.fn(),
    },
  }));
  vi.doMock("./debugLogger", () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }));
  vi.doMock("./gnomeShortcut", () => ({
    isWayland: vi.fn(() => false),
  }));
  vi.doMock("./environment", () => ({
    default: vi.fn(),
    saveAllKeysToEnvFile: vi.fn(),
  }));

  const { default: HotkeyManager } = await import("./hotkeyManager.js");
  const manager = new HotkeyManager();
  const setupShortcuts = vi.fn((hotkey: string) => {
    manager.currentHotkey = hotkey;
    return { success: true, hotkey };
  });
  manager.setupShortcuts = setupShortcuts;
  return { manager, setupShortcuts };
}

function createMainWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      executeJavaScript: vi.fn(async (script: string) =>
        script.includes("getItem") ? "Alt+C" : true
      ),
      send: vi.fn(),
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
  if (originalDictationKey === undefined) delete process.env.DICTATION_KEY;
  else process.env.DICTATION_KEY = originalDictationKey;
});

describe("HotkeyManager reserved shortcut migration", () => {
  it.each([
    ["win32", "Control+Super"],
    ["darwin", "GLOBE"],
    ["linux", "Control+Super"],
  ] as const)("migrates saved Alt+C on %s to %s", async (platform, fallback) => {
    const { manager, setupShortcuts } = await createManager(platform);
    const mainWindow = createMainWindow();
    manager.mainWindow = mainWindow;

    await manager.loadSavedHotkeyOrDefault(mainWindow, vi.fn());

    expect(manager.getCurrentHotkey()).toBe(fallback);
    expect(process.env.DICTATION_KEY).toBe(fallback);
    expect(mainWindow.webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining(`localStorage.setItem("dictationKey", "${fallback}")`)
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      "hotkey-fallback-used",
      expect.objectContaining({ original: "Alt+C", fallback })
    );
    if (platform === "darwin") expect(setupShortcuts).not.toHaveBeenCalled();
    else expect(setupShortcuts).toHaveBeenCalledWith(fallback, expect.any(Function));
  });
});
