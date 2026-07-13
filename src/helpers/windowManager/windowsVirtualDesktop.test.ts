import { describe, expect, it, vi } from "vitest";

const {
  getWindowHandle,
  moveWindowToCurrentVirtualDesktop,
  resetWindowsVirtualDesktopSupportForTests,
  shouldRecreateExistingWindow,
} = require("./windowsVirtualDesktop");

const createWindow = (handle = 1234n) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(handle);
  return {
    getNativeWindowHandle: vi.fn(() => buffer),
    isDestroyed: vi.fn(() => false),
    setVisibleOnAllWorkspaces: vi.fn(),
  };
};

describe("moveWindowToCurrentVirtualDesktop", () => {
  it("reads a 64-bit native window handle", () => {
    expect(getWindowHandle(createWindow(987654321n))).toBe("987654321");
  });

  it("confirms a Windows window is already on the active desktop with the built-in COM API", async () => {
    resetWindowsVirtualDesktopSupportForTests();
    const browserWindow = createWindow();
    const execFile = vi.fn((_file, args, options, callback) => {
      expect(args).toContain("-NoProfile");
      expect(args.at(-1)).toContain("[Int64]1234");
      expect(args.at(-1)).toContain("IVirtualDesktopManager");
      expect(args.at(-1)).not.toContain("Import-Module VirtualDesktop");
      expect(options).toMatchObject({ windowsHide: true, timeout: 2000 });
      callback(null, "CURRENT\r\n", "");
    });

    await expect(
      moveWindowToCurrentVirtualDesktop(browserWindow, {
        platform: "win32",
        execFile,
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).resolves.toMatchObject({ success: true, mode: "already-current" });
    expect(execFile).toHaveBeenCalledOnce();
  });

  it("requests safe BrowserWindow recreation when the window belongs to another desktop", async () => {
    resetWindowsVirtualDesktopSupportForTests();
    const browserWindow = createWindow();
    const execFile = vi.fn((_file, _args, _options, callback) => callback(null, "OTHER\r\n", ""));

    await expect(
      moveWindowToCurrentVirtualDesktop(browserWindow, {
        platform: "win32",
        execFile,
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).resolves.toMatchObject({
      success: false,
      needsRecreate: true,
      mode: "different-desktop",
    });
  });

  it("caches only a confirmed unsupported COM runtime", async () => {
    resetWindowsVirtualDesktopSupportForTests();
    const browserWindow = createWindow();
    const error: any = new Error("Class not registered 80040154");
    error.stderr = "REGDB_E_CLASSNOTREG";
    const execFile = vi.fn((_file, _args, _options, callback) => callback(error, "", error.stderr));

    await expect(
      moveWindowToCurrentVirtualDesktop(browserWindow, {
        platform: "win32",
        execFile,
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).resolves.toMatchObject({ success: false, unsupported: true });
    await expect(
      moveWindowToCurrentVirtualDesktop(browserWindow, {
        platform: "win32",
        execFile,
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).resolves.toMatchObject({ success: false, unsupported: true });
    expect(execFile).toHaveBeenCalledOnce();
  });

  it("uses Electron's workspace API on supported non-Windows platforms", async () => {
    const browserWindow = createWindow();

    await expect(
      moveWindowToCurrentVirtualDesktop(browserWindow, {
        platform: "linux",
        execFile: vi.fn(),
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).resolves.toMatchObject({ success: true });

    expect(browserWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true);
  });

  it("recreates an existing Windows panel when desktop ownership is indeterminate", () => {
    expect(shouldRecreateExistingWindow({ success: false, unsupported: true }, "win32")).toBe(true);
    expect(shouldRecreateExistingWindow({ success: false, error: "timed out" }, "win32")).toBe(true);
    expect(shouldRecreateExistingWindow({ success: true }, "win32")).toBe(false);
    expect(shouldRecreateExistingWindow({ success: false }, "darwin")).toBe(false);
  });
});
