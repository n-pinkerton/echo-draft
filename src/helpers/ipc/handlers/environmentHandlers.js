function registerEnvironmentHandlers({ ipcMain }, { environmentManager }) {
  ipcMain.handle("get-openai-key", async () => {
    return environmentManager.getOpenAIKey();
  });

  ipcMain.handle("save-openai-key", async (_event, key) => {
    return environmentManager.saveOpenAIKey(key);
  });

  ipcMain.handle("create-production-env-file", async (_event, apiKey) => {
    return environmentManager.createProductionEnvFile(apiKey);
  });
}

module.exports = { registerEnvironmentHandlers };

