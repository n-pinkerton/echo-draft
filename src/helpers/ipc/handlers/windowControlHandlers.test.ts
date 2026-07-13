import { describe, expect, it, vi } from "vitest";

import { registerWindowControlHandlers } from "./windowControlHandlers.js";

describe("windowControlHandlers", () => {
  it("opens the control panel when show-control-panel is invoked", async () => {
    const handles = new Map<string, (...args: any[]) => any>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
        handles.set(channel, handler);
      }),
    };
    const windowManager = {
      createControlPanelWindow: vi.fn(async () => {}),
      hideDictationPanel: vi.fn(),
      showDictationPanel: vi.fn(),
      showRecordingIndicator: vi.fn(() => ({ success: true })),
      setMainWindowInteractivity: vi.fn(),
      resizeMainWindow: vi.fn(),
    };

    registerWindowControlHandlers({ ipcMain, app: { quit: vi.fn() } } as any, {
      windowManager,
    } as any);

    const result = await handles.get("show-control-panel")?.();

    expect(windowManager.createControlPanelWindow).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it("shows the click-through recording indicator through a dedicated IPC route", () => {
    const handles = new Map<string, (...args: any[]) => any>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
        handles.set(channel, handler);
      }),
    };
    const windowManager = {
      createControlPanelWindow: vi.fn(),
      hideDictationPanel: vi.fn(),
      showDictationPanel: vi.fn(),
      showRecordingIndicator: vi.fn(() => ({ success: true })),
      setMainWindowInteractivity: vi.fn(),
      resizeMainWindow: vi.fn(),
    };

    registerWindowControlHandlers({ ipcMain, app: { quit: vi.fn() } } as any, {
      windowManager,
    } as any);

    expect(handles.get("show-recording-indicator")?.()).toEqual({ success: true });
    expect(windowManager.showRecordingIndicator).toHaveBeenCalledTimes(1);
  });
});
