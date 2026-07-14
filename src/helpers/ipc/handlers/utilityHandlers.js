const AppUtils = require("../../../utils");
const { requireTrustedRenderer } = require("../trustedRenderer");
const { setHotkeyCaptureMode } = require("../hotkeyCaptureLifecycle");
const { normalizeExternalHttpsUrl } = require("../../externalUrl");

function registerUtilityHandlers(
  { ipcMain, shell, globalShortcut },
  { windowManager, windowsKeyManager }
) {
  const requireControlPanel = (event) =>
    requireTrustedRenderer(event, windowManager, ["control-panel"]);

  ipcMain.handle("cleanup-app", async (event) => {
    requireTrustedRenderer(event, windowManager);
    AppUtils.cleanup(windowManager.mainWindow);
    return { success: true, message: "Cleanup completed successfully" };
  });

  ipcMain.handle("update-hotkey", async (event, hotkey) => {
    requireControlPanel(event);
    return await windowManager.updateHotkey(hotkey);
  });

  ipcMain.handle("update-clipboard-hotkey", async (event, hotkey) => {
    requireControlPanel(event);
    return await windowManager.updateClipboardHotkey(hotkey);
  });

  ipcMain.handle(
    "set-hotkey-listening-mode",
    async (event, enabled, newHotkey = null, target = "insert") => {
      requireControlPanel(event);
      if (typeof enabled !== "boolean" || !["insert", "clipboard"].includes(target)) {
        throw new Error("Invalid hotkey capture request");
      }
      return await setHotkeyCaptureMode(
        { enabled, newHotkey, target },
        { windowManager, windowsKeyManager, globalShortcut }
      );
    }
  );

  ipcMain.handle("get-hotkey-mode-info", async (event) => {
    requireControlPanel(event);
    return {
      isUsingGnome: windowManager.isUsingGnomeHotkeys(),
    };
  });

  ipcMain.handle("start-window-drag", async (event) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    return await windowManager.startWindowDrag();
  });

  ipcMain.handle("stop-window-drag", async (event) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    return await windowManager.stopWindowDrag();
  });

  ipcMain.handle("open-external", async (event, url) => {
    requireControlPanel(event);
    try {
      await shell.openExternal(normalizeExternalHttpsUrl(url));
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerUtilityHandlers };
