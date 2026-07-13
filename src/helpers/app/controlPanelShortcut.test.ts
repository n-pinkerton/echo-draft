import { describe, expect, it, vi } from "vitest";

const { registerControlPanelShortcut } = require("./controlPanelShortcut");

describe("registerControlPanelShortcut", () => {
  it("registers Ctrl+Alt+E, opens once at a time, and unregisters only itself", async () => {
    let callback: (() => void) | undefined;
    let finishOpen: (() => void) | undefined;
    const openPromise = new Promise<void>((resolve) => {
      finishOpen = resolve;
    });
    const createControlPanelWindow = vi.fn(() => openPromise);
    const globalShortcut = {
      register: vi.fn((_accelerator, nextCallback) => {
        callback = nextCallback;
        return true;
      }),
      unregister: vi.fn(),
    };

    const registration = registerControlPanelShortcut(
      { globalShortcut },
      {
        windowManager: { createControlPanelWindow },
        logger: { info: vi.fn(), warn: vi.fn() },
      }
    );

    expect(globalShortcut.register).toHaveBeenCalledWith("Control+Alt+E", expect.any(Function));
    callback?.();
    callback?.();
    expect(createControlPanelWindow).toHaveBeenCalledOnce();
    finishOpen?.();
    await openPromise;
    await Promise.resolve();

    callback?.();
    expect(createControlPanelWindow).toHaveBeenCalledTimes(2);
    registration.dispose();
    expect(globalShortcut.unregister).toHaveBeenCalledWith("Control+Alt+E");
  });

  it("reports an unavailable shortcut without unregistering another app", () => {
    const globalShortcut = {
      register: vi.fn(() => false),
      unregister: vi.fn(),
    };

    const registration = registerControlPanelShortcut(
      { globalShortcut },
      {
        windowManager: { createControlPanelWindow: vi.fn() },
        logger: { info: vi.fn(), warn: vi.fn() },
      }
    );

    expect(registration.registered).toBe(false);
    registration.dispose();
    expect(globalShortcut.unregister).not.toHaveBeenCalled();
  });
});
