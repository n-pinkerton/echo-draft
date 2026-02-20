// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setupShortcuts } = require("./hotkeySetupShortcuts");

function createDeps(overrides: any = {}) {
  return {
    platform: "win32",
    debugLogger: { log: vi.fn(), warn: vi.fn() },
    globalShortcut: {
      isRegistered: vi.fn(() => false),
      unregister: vi.fn(),
      register: vi.fn(() => true),
    },
    ...overrides,
  };
}

describe("hotkeySetupShortcuts", () => {
  it("throws when callback is missing", () => {
    const manager: any = { currentHotkey: "F8" };
    expect(() => setupShortcuts(manager, "F9", null, createDeps())).toThrow(
      /Callback function is required/
    );
  });

  it("returns early when the hotkey is already registered and current", () => {
    const manager: any = { currentHotkey: "Alt+F7" };
    const callback = vi.fn();
    const deps = createDeps({
      globalShortcut: {
        isRegistered: vi.fn(() => true),
        unregister: vi.fn(),
        register: vi.fn(() => true),
      },
    });

    const result = setupShortcuts(manager, "Alt+F7", callback, deps);

    expect(result).toEqual({ success: true, hotkey: "Alt+F7" });
    expect(deps.globalShortcut.unregister).not.toHaveBeenCalled();
    expect(deps.globalShortcut.register).not.toHaveBeenCalled();
  });

  it("uses native listeners for right-side modifiers and modifier-only combos on Windows", () => {
    const callback = vi.fn();

    const managerRight: any = { currentHotkey: "F8" };
    const deps = createDeps();
    const resultRight = setupShortcuts(managerRight, "RightAlt", callback, deps);
    expect(resultRight.success).toBe(true);
    expect(managerRight.currentHotkey).toBe("RightAlt");
    expect(deps.globalShortcut.register).not.toHaveBeenCalled();

    const managerMods: any = { currentHotkey: "F8" };
    const deps2 = createDeps();
    const resultMods = setupShortcuts(managerMods, "Control+Alt", callback, deps2);
    expect(resultMods.success).toBe(true);
    expect(managerMods.currentHotkey).toBe("Control+Alt");
    expect(deps2.globalShortcut.register).not.toHaveBeenCalled();
  });

  it("registers accelerator hotkeys with globalShortcut", () => {
    const manager: any = { currentHotkey: "F8" };
    const callback = vi.fn();
    const deps = createDeps();

    const result = setupShortcuts(manager, "Alt+F7", callback, deps);

    expect(result).toEqual({ success: true, hotkey: "Alt+F7" });
    expect(deps.globalShortcut.register).toHaveBeenCalledWith("Alt+F7", callback);
    expect(manager.currentHotkey).toBe("Alt+F7");
  });

  it("restores the previous hotkey when registration fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const manager: any = { currentHotkey: "F8" };
    const callback = vi.fn();
    const deps = createDeps({
      globalShortcut: {
        isRegistered: vi.fn(() => false),
        unregister: vi.fn(),
        register: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
      },
    });

    const result = setupShortcuts(manager, "F9", callback, deps);

    expect(result.success).toBe(false);
    expect(deps.globalShortcut.register).toHaveBeenNthCalledWith(1, "F9", callback);
    expect(deps.globalShortcut.register).toHaveBeenNthCalledWith(2, "F8", callback);
    expect(manager.currentHotkey).toBe("F8");
  });
});
