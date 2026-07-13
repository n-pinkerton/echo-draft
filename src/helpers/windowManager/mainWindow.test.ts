import { describe, expect, it, vi } from "vitest";

import { handleMainWindowLoadFailure, showRecordingIndicator } from "./mainWindow.js";

const createManager = () => ({
  mainWindow: {
    isDestroyed: vi.fn(() => false),
    reload: vi.fn(),
  },
  showLoadFailureDialog: vi.fn(),
});

describe("dictation-window load failure presentation", () => {
  it("suppresses the load-failure dialog in safe E2E mode", () => {
    const manager = createManager();

    handleMainWindowLoadFailure(
      manager,
      {
        errorCode: -6,
        errorDescription: "FILE_NOT_FOUND",
        validatedURL: "file:///missing/index.html",
        isMainFrame: true,
      },
      {
        env: {
          OPENWHISPR_E2E: "1",
          OPENWHISPR_E2E_SUPPRESS_WINDOW_FOCUS: "1",
        },
      }
    );

    expect(manager.showLoadFailureDialog).not.toHaveBeenCalled();
  });

  it("still reports an ordinary packaged main-frame load failure", () => {
    const manager = createManager();

    handleMainWindowLoadFailure(
      manager,
      {
        errorCode: -6,
        errorDescription: "FILE_NOT_FOUND",
        validatedURL: "file:///missing/index.html",
        isMainFrame: true,
      },
      { env: { NODE_ENV: "production" } }
    );

    expect(manager.showLoadFailureDialog).toHaveBeenCalledWith(
      "Dictation panel",
      -6,
      "FILE_NOT_FOUND",
      "file:///missing/index.html"
    );
  });
});

describe("recording indicator window presentation", () => {
  it("resizes, stays click-through, and shows without taking focus", () => {
    let visible = false;
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => visible),
      getBounds: vi.fn(() => ({ x: 1200, y: 700, width: 96, height: 96 })),
      setBounds: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      showInactive: vi.fn(() => {
        visible = true;
      }),
      show: vi.fn(),
      focus: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setFullScreenable: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      moveTop: vi.fn(),
    };
    const manager = { mainWindow, isMainWindowInteractive: true };

    expect(
      showRecordingIndicator(manager, {
        screenModule: {
          getDisplayNearestPoint: vi.fn(() => ({
            workArea: { x: 0, y: 0, width: 1920, height: 1080 },
          })),
        } as any,
      })
    ).toEqual({ success: true });
    expect(mainWindow.setBounds).toHaveBeenCalledWith({
      x: 1036,
      y: 724,
      width: 260,
      height: 72,
    });
    expect(mainWindow.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
    expect(mainWindow.showInactive).toHaveBeenCalledTimes(1);
    expect(mainWindow.show).not.toHaveBeenCalled();
    expect(mainWindow.focus).not.toHaveBeenCalled();
    if (process.platform === "darwin") {
      expect(mainWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating", 1);
    } else {
      expect(mainWindow.setAlwaysOnTop).toHaveBeenCalledWith(
        true,
        process.platform === "win32" ? "pop-up-menu" : "screen-saver"
      );
    }
    expect(manager.isMainWindowInteractive).toBe(false);
  });

  it("applies the macOS floating-window policy without taking focus", () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    let visible = false;
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => visible),
      getBounds: vi.fn(() => ({ x: 1200, y: 700, width: 96, height: 96 })),
      setBounds: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      showInactive: vi.fn(() => {
        visible = true;
      }),
      show: vi.fn(),
      focus: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setFullScreenable: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      moveTop: vi.fn(),
    };
    const manager = { mainWindow, isMainWindowInteractive: true };

    try {
      expect(
        showRecordingIndicator(manager, {
          screenModule: {
            getDisplayNearestPoint: vi.fn(() => ({
              workArea: { x: 0, y: 0, width: 1920, height: 1080 },
            })),
          } as any,
        })
      ).toEqual({ success: true });
    } finally {
      platformSpy.mockRestore();
    }

    expect(mainWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating", 1);
    expect(mainWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    expect(mainWindow.setFullScreenable).toHaveBeenCalledWith(false);
    expect(mainWindow.showInactive).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).not.toHaveBeenCalled();
    expect(manager.isMainWindowInteractive).toBe(false);
  });
});
