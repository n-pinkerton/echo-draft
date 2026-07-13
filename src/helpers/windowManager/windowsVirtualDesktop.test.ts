import { describe, expect, it, vi } from "vitest";

const { getWindowHandle, pinWindowToAllVirtualDesktops } = require("./windowsVirtualDesktop");

const createWindow = (handle = 1234n) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(handle);
  return {
    getNativeWindowHandle: vi.fn(() => buffer),
    isDestroyed: vi.fn(() => false),
    setVisibleOnAllWorkspaces: vi.fn(),
  };
};

describe("pinWindowToAllVirtualDesktops", () => {
  it("reads a 64-bit native window handle", () => {
    expect(getWindowHandle(createWindow(987654321n))).toBe("987654321");
  });

  it("pins and confirms the Windows control panel through the existing module", async () => {
    const browserWindow = createWindow();
    const execFile = vi.fn((_file, args, options, callback) => {
      expect(args).toContain("-NoProfile");
      expect(args.at(-1)).toContain("[Int64]1234");
      expect(options).toMatchObject({ windowsHide: true, timeout: 5000 });
      callback(null, "PINNED\r\n", "");
    });

    await expect(
      pinWindowToAllVirtualDesktops(browserWindow, {
        platform: "win32",
        execFile,
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).resolves.toMatchObject({ success: true });

    await expect(
      pinWindowToAllVirtualDesktops(browserWindow, {
        platform: "win32",
        execFile,
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).resolves.toMatchObject({ success: true, cached: true });
    expect(execFile).toHaveBeenCalledOnce();
  });

  it("uses Electron's workspace API on supported non-Windows platforms", async () => {
    const browserWindow = createWindow();

    await expect(
      pinWindowToAllVirtualDesktops(browserWindow, {
        platform: "linux",
        execFile: vi.fn(),
        logger: { info: vi.fn(), warn: vi.fn() },
      })
    ).resolves.toMatchObject({ success: true });

    expect(browserWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true);
  });
});
