const { requireTrustedRenderer } = require("../trustedRenderer");

function registerWindowControlHandlers({ ipcMain, app }, { windowManager }) {
  const requireControlPanel = (event) =>
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
  const requireDictation = (event) => requireTrustedRenderer(event, windowManager, ["dictation"]);

  ipcMain.handle("window-minimize", (event) => {
    requireControlPanel(event);
    if (windowManager.controlPanelWindow) {
      windowManager.controlPanelWindow.minimize();
    }
  });

  ipcMain.handle("window-maximize", (event) => {
    requireControlPanel(event);
    if (windowManager.controlPanelWindow) {
      if (windowManager.controlPanelWindow.isMaximized()) {
        windowManager.controlPanelWindow.unmaximize();
      } else {
        windowManager.controlPanelWindow.maximize();
      }
    }
  });

  ipcMain.handle("window-close", (event) => {
    requireControlPanel(event);
    if (windowManager.controlPanelWindow) {
      windowManager.controlPanelWindow.close();
    }
  });

  ipcMain.handle("window-is-maximized", (event) => {
    requireControlPanel(event);
    if (windowManager.controlPanelWindow) {
      return windowManager.controlPanelWindow.isMaximized();
    }
    return false;
  });

  ipcMain.handle("app-quit", (event) => {
    requireControlPanel(event);
    app.quit();
  });

  ipcMain.handle("hide-window", (event) => {
    requireDictation(event);
    if (process.platform === "darwin") {
      windowManager.hideDictationPanel();
      if (app.dock) app.dock.show();
    } else {
      windowManager.hideDictationPanel();
    }
  });

  ipcMain.handle("show-dictation-panel", (event) => {
    requireTrustedRenderer(event, windowManager);
    windowManager.showDictationPanel();
  });

  ipcMain.handle("show-recording-indicator", (event) => {
    requireDictation(event);
    return windowManager.showRecordingIndicator();
  });

  ipcMain.handle("show-control-panel", async (event) => {
    requireTrustedRenderer(event, windowManager);
    await windowManager.createControlPanelWindow();
    return { success: true };
  });

  ipcMain.handle("get-control-panel-shortcut-status", (event) => {
    requireControlPanel(event);
    return (
      windowManager.getControlPanelShortcutStatus?.() || {
        accelerator: "Alt+C",
        registered: false,
        reason: "unavailable",
      }
    );
  });

  ipcMain.handle("force-stop-dictation", (event) => {
    requireTrustedRenderer(event, windowManager);
    if (windowManager?.forceStopMacCompoundPush) {
      windowManager.forceStopMacCompoundPush("manual");
    }
    return { success: true };
  });

  ipcMain.handle("set-main-window-interactivity", (event, shouldCapture) => {
    requireDictation(event);
    windowManager.setMainWindowInteractivity(Boolean(shouldCapture));
    return { success: true };
  });

  ipcMain.handle("resize-main-window", (event, sizeKey) => {
    requireDictation(event);
    return windowManager.resizeMainWindow(sizeKey);
  });
}

module.exports = { registerWindowControlHandlers };
