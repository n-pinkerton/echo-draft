function registerUpdateHandlers({ ipcMain }, { updateManager }) {
  ipcMain.handle("check-for-updates", async () => {
    return updateManager.checkForUpdates();
  });

  ipcMain.handle("download-update", async () => {
    return updateManager.downloadUpdate();
  });

  ipcMain.handle("install-update", async () => {
    return updateManager.installUpdate();
  });

  ipcMain.handle("get-app-version", async () => {
    return updateManager.getAppVersion();
  });

  ipcMain.handle("get-update-status", async () => {
    return updateManager.getUpdateStatus();
  });

  ipcMain.handle("get-update-info", async () => {
    return updateManager.getUpdateInfo();
  });
}

module.exports = { registerUpdateHandlers };

