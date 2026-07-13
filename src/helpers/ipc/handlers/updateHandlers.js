const { requireTrustedRenderer } = require("../trustedRenderer");
const { VERIFIED_RELEASES_URL } = require("../../../updater");

function registerUpdateHandlers({ ipcMain, shell }, { updateManager, windowManager }) {
  const requireControlPanel = (event) =>
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
  ipcMain.handle("check-for-updates", async (event) => {
    requireControlPanel(event);
    return updateManager.checkForUpdates();
  });

  ipcMain.handle("download-update", async (event) => {
    requireControlPanel(event);
    return updateManager.downloadUpdate();
  });

  ipcMain.handle("install-update", async (event) => {
    requireControlPanel(event);
    return updateManager.installUpdate();
  });

  ipcMain.handle("get-app-version", async (event) => {
    requireTrustedRenderer(event, windowManager);
    return updateManager.getAppVersion();
  });

  ipcMain.handle("get-update-status", async (event) => {
    requireControlPanel(event);
    return updateManager.getUpdateStatus();
  });

  ipcMain.handle("get-update-info", async (event) => {
    requireControlPanel(event);
    return updateManager.getUpdateInfo();
  });

  ipcMain.handle("open-verified-releases", async (event) => {
    requireControlPanel(event);
    await shell.openExternal(VERIFIED_RELEASES_URL);
    return { success: true };
  });
}

module.exports = { registerUpdateHandlers };
