import { describe, expect, it, vi } from "vitest";

import { registerWindowControlHandlers } from "./windowControlHandlers.js";

const createHarness = () => {
  const handles = new Map<string, (...args: any[]) => any>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handles.set(channel, handler);
    }),
  };
  const controlFrame = { url: "file:///app/index.html?controlPanel=true" };
  const dictationFrame = { url: "file:///app/index.html" };
  const controlSender = { mainFrame: controlFrame, getURL: () => controlFrame.url };
  const dictationSender = { mainFrame: dictationFrame, getURL: () => dictationFrame.url };
  const controlPanelWindow = {
    __echoDraftTrustedUrl: controlFrame.url,
    webContents: controlSender,
    isDestroyed: () => false,
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    isMaximized: vi.fn(() => false),
    close: vi.fn(),
  };
  const mainWindow = {
    __echoDraftTrustedUrl: dictationFrame.url,
    webContents: dictationSender,
    isDestroyed: () => false,
  };
  const windowManager = {
    controlPanelWindow,
    mainWindow,
    createControlPanelWindow: vi.fn(async () => {}),
    hideDictationPanel: vi.fn(),
    showDictationPanel: vi.fn(),
    showRecordingIndicator: vi.fn(() => ({ success: true })),
    setMainWindowInteractivity: vi.fn(),
    resizeMainWindow: vi.fn(),
    getControlPanelShortcutStatus: vi.fn(() => ({
      accelerator: "Alt+C",
      registered: true,
      reason: null,
    })),
  };
  const app = { quit: vi.fn() };

  registerWindowControlHandlers({ ipcMain, app } as any, { windowManager } as any);

  return {
    app,
    handles,
    windowManager,
    controlEvent: { sender: controlSender, senderFrame: controlFrame },
    dictationEvent: { sender: dictationSender, senderFrame: dictationFrame },
  };
};

describe("windowControlHandlers", () => {
  it("opens the control panel and reports its shortcut to trusted renderers", async () => {
    const harness = createHarness();

    const result = await harness.handles.get("show-control-panel")?.(harness.dictationEvent);

    expect(harness.windowManager.createControlPanelWindow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
    expect(
      harness.handles.get("get-control-panel-shortcut-status")?.(harness.controlEvent)
    ).toEqual({
      accelerator: "Alt+C",
      registered: true,
      reason: null,
    });
  });

  it("shows the click-through recording indicator only for the dictation renderer", () => {
    const harness = createHarness();

    expect(harness.handles.get("show-recording-indicator")?.(harness.dictationEvent)).toEqual({
      success: true,
    });
    expect(harness.windowManager.showRecordingIndicator).toHaveBeenCalledTimes(1);
    expect(() => harness.handles.get("show-recording-indicator")?.(harness.controlEvent)).toThrow(
      /renderer is not trusted/i
    );
  });

  it("rejects untrusted senders before allowing window or application control", () => {
    const harness = createHarness();
    const untrustedFrame = { url: "https://attacker.invalid/" };
    const untrustedEvent = {
      sender: { mainFrame: untrustedFrame, getURL: () => untrustedFrame.url },
      senderFrame: untrustedFrame,
    };

    expect(() => harness.handles.get("window-minimize")?.(untrustedEvent)).toThrow(
      /renderer is not trusted/i
    );
    expect(() => harness.handles.get("app-quit")?.(untrustedEvent)).toThrow(
      /renderer is not trusted/i
    );
    expect(harness.windowManager.controlPanelWindow.minimize).not.toHaveBeenCalled();
    expect(harness.app.quit).not.toHaveBeenCalled();
  });
});
