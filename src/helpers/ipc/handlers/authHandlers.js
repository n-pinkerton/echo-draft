const debugLogger = require("../../debugLogger");

function registerAuthHandlers({ ipcMain, BrowserWindow }) {
  ipcMain.handle("auth-clear-session", async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        await win.webContents.session.clearStorageData({ storages: ["cookies"] });
      }
      return { success: true };
    } catch (error) {
      debugLogger.error("Failed to clear auth session:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerAuthHandlers };

