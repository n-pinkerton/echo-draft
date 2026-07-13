const debugLogger = require("../../debugLogger");
const { requireTrustedRenderer } = require("../trustedRenderer");

function registerAutoStartHandlers({ ipcMain, app }, { windowManager }) {
  ipcMain.handle("get-auto-start-enabled", async (event) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    try {
      const loginSettings = app.getLoginItemSettings();
      return loginSettings.openAtLogin;
    } catch (error) {
      debugLogger.error("Error getting auto-start status:", error);
      return false;
    }
  });

  ipcMain.handle("set-auto-start-enabled", async (event, enabled) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    if (typeof enabled !== "boolean") throw new Error("Invalid auto-start setting");
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
