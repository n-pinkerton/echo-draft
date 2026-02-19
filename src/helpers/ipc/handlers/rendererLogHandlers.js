const debugLogger = require("../../debugLogger");

function registerRendererLogHandlers({ ipcMain }) {
  ipcMain.handle("get-log-level", async () => {
    return debugLogger.getLevel();
  });

  ipcMain.handle("app-log", async (_event, entry) => {
    debugLogger.logEntry(entry);
    return { success: true };
  });
}

module.exports = { registerRendererLogHandlers };

