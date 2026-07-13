import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function loadHook(getUpdateStatus: () => Promise<any>) {
  vi.resetModules();
  window.electronAPI = {
    getUpdateStatus,
    getUpdateInfo: vi.fn(async () => null),
  } as any;
  const { useUpdater } = await import("./useUpdater");
  return renderHook(() => useUpdater());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useUpdater initialization", () => {
  it("remains explicitly loading until update status resolves", async () => {
    const status = deferred<any>();
    const hook = await loadHook(() => status.promise);

    expect(hook.result.current.isInitialized).toBe(false);
    expect(hook.result.current.isInitializing).toBe(true);
    expect(hook.result.current.status.updatesEnabled).toBe(false);

    await act(async () => {
      status.resolve({
        updateAvailable: false,
        updateDownloaded: false,
        hasCheckedForUpdates: false,
        isChecking: false,
        isDevelopment: false,
        updatesEnabled: true,
      });
      await status.promise;
    });

    await waitFor(() => expect(hook.result.current.isInitialized).toBe(true));
    expect(hook.result.current.isInitializing).toBe(false);
    expect(hook.result.current.status.updatesEnabled).toBe(true);
    expect(hook.result.current.status.hasCheckedForUpdates).toBe(false);
    expect(hook.result.current.isChecking).toBe(false);
  });

  it("tracks automatic checking and completion events after initialization", async () => {
    vi.resetModules();
    let checkingListener: (() => void) | undefined;
    let notAvailableListener: (() => void) | undefined;
    window.electronAPI = {
      getUpdateStatus: vi.fn(async () => ({
        updateAvailable: false,
        updateDownloaded: false,
        hasCheckedForUpdates: false,
        isChecking: false,
        isDevelopment: false,
        updatesEnabled: true,
      })),
      getUpdateInfo: vi.fn(async () => null),
      onCheckingForUpdate: vi.fn((listener) => {
        checkingListener = listener;
        return vi.fn();
      }),
      onUpdateNotAvailable: vi.fn((listener) => {
        notAvailableListener = listener;
        return vi.fn();
      }),
    } as any;
    const { useUpdater } = await import("./useUpdater");
    const hook = renderHook(() => useUpdater());

    await waitFor(() => expect(hook.result.current.isInitialized).toBe(true));
    expect(hook.result.current.status.hasCheckedForUpdates).toBe(false);

    act(() => checkingListener?.());
    expect(hook.result.current.isChecking).toBe(true);
    expect(hook.result.current.status.isChecking).toBe(true);

    act(() => notAvailableListener?.());
    expect(hook.result.current.isChecking).toBe(false);
    expect(hook.result.current.status.isChecking).toBe(false);
    expect(hook.result.current.status.hasCheckedForUpdates).toBe(true);
  });

  it("exposes honest manual recovery state when status initialization rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const hook = await loadHook(async () => {
      throw new Error("status unavailable");
    });

    await waitFor(() => expect(hook.result.current.isInitialized).toBe(true));
    expect(hook.result.current.isInitializing).toBe(false);
    expect(hook.result.current.status.updatesEnabled).toBe(false);
    expect(hook.result.current.status.disabledReason).toMatch(/download updates manually/i);
    expect(hook.result.current.error).toHaveProperty("message", "status unavailable");
  });

  it("clears both checking fields after a rejected check and allows retry", async () => {
    vi.resetModules();
    const checkForUpdates = vi
      .fn()
      .mockRejectedValueOnce(new Error("update endpoint unavailable"))
      .mockResolvedValueOnce({ updateAvailable: false, message: "No updates available" });
    window.electronAPI = {
      getUpdateStatus: vi.fn(async () => ({
        updateAvailable: false,
        updateDownloaded: false,
        hasCheckedForUpdates: false,
        isChecking: false,
        isDevelopment: false,
        updatesEnabled: true,
      })),
      getUpdateInfo: vi.fn(async () => null),
      checkForUpdates,
    } as any;
    const { useUpdater } = await import("./useUpdater");
    const hook = renderHook(() => useUpdater());
    await waitFor(() => expect(hook.result.current.isInitialized).toBe(true));

    await act(async () => {
      await expect(hook.result.current.checkForUpdates()).rejects.toThrow(
        "update endpoint unavailable"
      );
    });

    expect(hook.result.current.isChecking).toBe(false);
    expect(hook.result.current.status.isChecking).toBe(false);
    expect(hook.result.current.status.hasCheckedForUpdates).toBe(false);
    expect(hook.result.current.error).toHaveProperty("message", "update endpoint unavailable");

    await act(async () => {
      await expect(hook.result.current.checkForUpdates()).resolves.toMatchObject({
        updateAvailable: false,
      });
    });
    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect(hook.result.current.status.hasCheckedForUpdates).toBe(true);
  });
});
