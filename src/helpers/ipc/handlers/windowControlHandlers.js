function registerWindowControlHandlers({ ipcMain, app }, { windowManager }) {
  ipcMain.handle("window-minimize", () => {
    if (windowManager.controlPanelWindow) {
      windowManager.controlPanelWindow.minimize();
    }
  });

  ipcMain.handle("window-maximize", () => {
    if (windowManager.controlPanelWindow) {
      if (windowManager.controlPanelWindow.isMaximized()) {
        windowManager.controlPanelWindow.unmaximize();
      } else {
        windowManager.controlPanelWindow.maximize();
      }
    }
  });

  ipcMain.handle("window-close", () => {
    if (windowManager.controlPanelWindow) {
      windowManager.controlPanelWindow.close();
    }
  });

  ipcMain.handle("window-is-maximized", () => {
    if (windowManager.controlPanelWindow) {
      return windowManager.controlPanelWindow.isMaximized();
    }
    return false;
  });

  ipcMain.handle("app-quit", () => {
    app.quit();
  });

  ipcMain.handle("hide-window", () => {
    if (process.platform === "darwin") {
      windowManager.hideDictationPanel();
      if (app.dock) app.dock.show();
    } else {
      windowManager.hideDictationPanel();
    }
  });

  ipcMain.handle("show-dictation-panel", () => {
    windowManager.showDictationPanel();
  });

  ipcMain.handle("force-stop-dictation", () => {
    if (windowManager?.forceStopMacCompoundPush) {
      windowManager.forceStopMacCompoundPush("manual");
    }
    return { success: true };
  });

  ipcMain.handle("set-main-window-interactivity", (_event, shouldCapture) => {
    windowManager.setMainWindowInteractivity(Boolean(shouldCapture));
    return { success: true };
  });

  ipcMain.handle("resize-main-window", (_event, sizeKey) => {
    return windowManager.resizeMainWindow(sizeKey);
  });
}

module.exports = { registerWindowControlHandlers };

