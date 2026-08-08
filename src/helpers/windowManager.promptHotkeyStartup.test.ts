// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import WindowManager from "./windowManager.js";

const originalPlatform = process.platform;

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
});

describe("WindowManager prompt hotkey startup", () => {
  it("refreshes both prompt shortcuts after the delayed insert hotkey resolves", async () => {
    vi.useFakeTimers();
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });

    const registered = new Map<string, () => void>();
    const shortcutApi = {
      register: vi.fn((accelerator: string, callback: () => void) => {
        registered.set(accelerator, callback);
        return true;
      }),
      unregister: vi.fn((accelerator: string) => registered.delete(accelerator)),
    };
    let insertHotkey = "Control+Super";
    const manager: any = Object.create(WindowManager.prototype);
    manager.mainWindow = {};
    manager.currentClipboardHotkey = "F9";
    manager._cachedActivationMode = "tap";
    manager.registeredPromptAccelerators = new Map();
    manager.createHotkeyCallback = vi.fn(() => vi.fn());
    manager.registerPromptHotkeys = WindowManager.prototype.registerPromptHotkeys.bind(
      manager,
      shortcutApi
    );
    manager.hotkeyManager = {
      getCurrentHotkey: vi.fn(() => insertHotkey),
      initializeHotkey: vi.fn(
        async (
          _window: unknown,
          _callback: () => void,
          onHotkeyResolved: (hotkey: string) => void | Promise<void>
        ) => {
          setTimeout(async () => {
            insertHotkey = "F10";
            await onHotkeyResolved(insertHotkey);
          }, 1000);
        }
      ),
    };

    await manager.initializeHotkey();
    manager.registerPromptHotkeys();

    expect(registered.has("Alt+F9")).toBe(true);
    expect(registered.has("Alt+F10")).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);

    expect(registered.has("Alt+F9")).toBe(true);
    expect(registered.has("Alt+F10")).toBe(true);
  });
});
