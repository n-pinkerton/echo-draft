const debugLogger = require("../../debugLogger");

function registerAutoStartHandlers({ ipcMain, app }) {
  ipcMain.handle("get-auto-start-enabled", async () => {
    try {
      const loginSettings = app.getLoginItemSettings();
      return loginSettings.openAtLogin;
    } catch (error) {
      debugLogger.error("Error getting auto-start status:", error);
      return false;
    }
  });

  ipcMain.handle("set-auto-start-enabled", async (_event, enabled) => {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true, // Start minimized to tray
      });
      debugLogger.debug("Auto-start setting updated", { enabled });
      return { success: true };
    } catch (error) {
      debugLogger.error("Error setting auto-start:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerAutoStartHandlers };

