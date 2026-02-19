function registerClipboardHandlers({ ipcMain }, { clipboardManager }) {
  ipcMain.handle("paste-text", async (event, text, options) => {
    return clipboardManager.pasteText(text, { ...options, webContents: event.sender });
  });

  ipcMain.handle("read-clipboard", async () => {
    return clipboardManager.readClipboard();
  });

  ipcMain.handle("write-clipboard", async (event, text) => {
    return clipboardManager.writeClipboard(text, event.sender);
  });

  ipcMain.handle("capture-insertion-target", async () => {
    if (!clipboardManager?.captureInsertionTarget) {
      return { success: false, reason: "unavailable" };
    }
    return clipboardManager.captureInsertionTarget();
  });

  ipcMain.handle("check-paste-tools", async () => {
    return clipboardManager.checkPasteTools();
  });
}

module.exports = { registerClipboardHandlers };

