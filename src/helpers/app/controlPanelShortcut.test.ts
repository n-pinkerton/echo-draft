import { describe, expect, it, vi } from "vitest";

const { registerControlPanelShortcut } = require("./controlPanelShortcut");

describe("registerControlPanelShortcut", () => {
  it("registers Alt+C, opens once at a time, and unregisters only itself", async () => {
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

    expect(globalShortcut.register).toHaveBeenCalledWith("Alt+C", expect.any(Function));
    callback?.();
    callback?.();
    expect(createControlPanelWindow).toHaveBeenCalledOnce();
    finishOpen?.();
    await openPromise;
    await Promise.resolve();

    callback?.();
    expect(createControlPanelWindow).toHaveBeenCalledTimes(2);
    registration.dispose();
    expect(globalShortcut.unregister).toHaveBeenCalledWith("Alt+C");
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

  it("retries an externally held shortcut and reports recovery", async () => {
    vi.useFakeTimers();
    const onStatusChange = vi.fn();
    const globalShortcut = {
      register: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
      unregister: vi.fn(),
      isRegistered: vi.fn(() => true),
    };

    const registration = registerControlPanelShortcut(
      { globalShortcut },
      {
        windowManager: { createControlPanelWindow: vi.fn() },
        logger: { info: vi.fn(), warn: vi.fn() },
        retryMs: 20,
        onStatusChange,
      }
    );

    expect(registration.getStatus()).toMatchObject({ registered: false });
    await vi.advanceTimersByTimeAsync(21);
    expect(registration.getStatus()).toMatchObject({ registered: true, reason: null });
    expect(globalShortcut.register).toHaveBeenCalledTimes(2);
    expect(onStatusChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ accelerator: "Alt+C", registered: true })
    );

    registration.dispose();
    vi.useRealTimers();
  });
});
