const debugLogger = require("../../debugLogger");

const SYSTEM_SETTINGS_URLS = {
  darwin: {
    microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    sound: "x-apple.systempreferences:com.apple.preference.sound?input",
    accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  },
  win32: {
    microphone: "ms-settings:privacy-microphone",
    sound: "ms-settings:sound",
  },
};

function registerSystemSettingsHandlers({ ipcMain, shell }) {
  const openSystemSettings = async (settingType) => {
    const platform = process.platform;
    const urls = SYSTEM_SETTINGS_URLS[platform];
    const url = urls?.[settingType];

    if (!url) {
      // Platform doesn't support this settings URL
      const messages = {
        microphone: "Please open your system settings to configure microphone permissions.",
        sound: "Please open your system sound settings (e.g., pavucontrol).",
        accessibility: "Accessibility settings are not applicable on this platform.",
      };
      return {
        success: false,
        error:
          messages[settingType] || `${settingType} settings are not available on this platform.`,
      };
    }

    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      debugLogger.error(`Failed to open ${settingType} settings:`, error);
      return { success: false, error: error.message };
    }
  };

  ipcMain.handle("open-microphone-settings", () => openSystemSettings("microphone"));
  ipcMain.handle("open-sound-input-settings", () => openSystemSettings("sound"));
  ipcMain.handle("open-accessibility-settings", () => openSystemSettings("accessibility"));

  ipcMain.handle("request-microphone-access", async () => {
    if (process.platform !== "darwin") {
      return { granted: true };
    }
    const { systemPreferences } = require("electron");
    const granted = await systemPreferences.askForMediaAccess("microphone");
    return { granted };
  });
}

module.exports = { registerSystemSettingsHandlers };

