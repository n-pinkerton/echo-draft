import { describe, expect, it, vi } from "vitest";

import { WindowPositionUtil } from "./windowConfig.js";

const createWindow = () => ({
  isVisible: vi.fn(() => true),
  moveTop: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  setFullScreenable: vi.fn(),
  setVisibleOnAllWorkspaces: vi.fn(),
});

describe("WindowPositionUtil.setupAlwaysOnTop", () => {
  it("uses the Windows pop-up-menu level", () => {
    const window = createWindow();

    WindowPositionUtil.setupAlwaysOnTop(window, "win32");

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "pop-up-menu");
    expect(window.moveTop).toHaveBeenCalledTimes(1);
  });

  it("uses the macOS floating level and workspace behavior", () => {
    const window = createWindow();

    WindowPositionUtil.setupAlwaysOnTop(window, "darwin");

    expect(window.setAlwaysOnTop).toHaveBeenCalledTimes(2);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating", 1);
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    expect(window.setFullScreenable).toHaveBeenCalledWith(false);
    expect(window.moveTop).toHaveBeenCalledTimes(1);
  });

  it("uses the Linux screen-saver level", () => {
    const window = createWindow();

    WindowPositionUtil.setupAlwaysOnTop(window, "linux");

    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "screen-saver");
    expect(window.moveTop).toHaveBeenCalledTimes(1);
  });
});
