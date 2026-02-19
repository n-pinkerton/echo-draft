function registerLlamaCppHandlers({ ipcMain }) {
  ipcMain.handle("llama-cpp-check", async () => {
    try {
      const llamaCppInstaller = require("../../llamaCppInstaller").default;
      const isInstalled = await llamaCppInstaller.isInstalled();
      const version = isInstalled ? await llamaCppInstaller.getVersion() : null;
      return { isInstalled, version };
    } catch (error) {
      return { isInstalled: false, error: error.message };
    }
  });

  ipcMain.handle("llama-cpp-install", async () => {
    try {
      const llamaCppInstaller = require("../../llamaCppInstaller").default;
      return await llamaCppInstaller.install();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("llama-cpp-uninstall", async () => {
    try {
      const llamaCppInstaller = require("../../llamaCppInstaller").default;
      return await llamaCppInstaller.uninstall();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerLlamaCppHandlers };

