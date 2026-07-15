import { describe, expect, it, vi } from "vitest";

import { CONTROL_PANEL_CONFIG, MAIN_WINDOW_CONFIG, WindowPositionUtil } from "./windowConfig.js";

const createWindow = () => ({
  isVisible: vi.fn(() => true),
  moveTop: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  setFullScreenable: vi.fn(),
  setVisibleOnAllWorkspaces: vi.fn(),
});

describe("WindowPositionUtil.setupAlwaysOnTop", () => {
  it("keeps dictation capture responsive while another application has focus", () => {
    expect(MAIN_WINDOW_CONFIG.webPreferences.backgroundThrottling).toBe(false);
    expect(MAIN_WINDOW_CONFIG.focusable).toBe(false);
    expect(MAIN_WINDOW_CONFIG).toMatchObject({
      transparent: true,
      backgroundColor: "#00000000",
    });
  });

  it("keeps the resizable control panel above a usable minimum size", () => {
    expect(CONTROL_PANEL_CONFIG).toMatchObject({
      resizable: true,
      minWidth: 760,
      minHeight: 600,
    });
  });

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
