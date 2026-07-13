const { requireTrustedRenderer } = require("../trustedRenderer");

const MAX_CLIPBOARD_TEXT_CHARS = 1_000_000;

const validateText = (text) => {
  if (typeof text !== "string" || text.length > MAX_CLIPBOARD_TEXT_CHARS) {
    const error = new Error("Clipboard text must be a string within the supported size limit.");
    error.code = "INVALID_CLIPBOARD_TEXT";
    throw error;
  }
};

function registerClipboardHandlers(
  { ipcMain, platform = process.platform },
  { clipboardManager, windowManager }
) {
  ipcMain.handle("paste-text", async (event, text, options) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    validateText(text);

    const normalizedOptions = {
      fromStreaming: options?.fromStreaming === true,
      webContents: event.sender,
    };
    if (platform === "win32" && !options?.insertionTarget) {
      const error = new Error(
        "Automatic insertion requires the authenticated window captured when dictation started."
      );
      error.code = "MISSING_INSERTION_TARGET";
      throw error;
    }
    if (options?.insertionTarget) {
      const sessionId = typeof options?.sessionId === "string" ? options.sessionId.trim() : "";
      if (!sessionId || !windowManager?.isIssuedDictationSession?.(sessionId, "insert")) {
        const error = new Error("The insertion target session is invalid or expired.");
        error.code = "INVALID_INSERTION_SESSION";
        throw error;
      }
      const target = clipboardManager.consumeInsertionTargetCapability(options.insertionTarget, {
        ownerId: event.sender.id,
        sessionId,
      });
      if (!target) {
        const error = new Error("The insertion target is invalid, expired, or already used.");
        error.code = "INVALID_INSERTION_TARGET";
        throw error;
      }
      normalizedOptions.insertionTarget = target;
    }

    return clipboardManager.pasteText(text, normalizedOptions);
  });

  ipcMain.handle("write-clipboard", async (event, text) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    validateText(text);
    return clipboardManager.writeClipboard(text, event.sender);
  });

  ipcMain.handle("capture-insertion-target", async (event, sessionId) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    if (!clipboardManager?.captureInsertionTarget) {
      return { success: false, reason: "unavailable" };
    }

    const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (!windowManager?.claimInsertionTargetSession?.(normalizedSessionId)) {
      return { success: false, reason: "invalid_or_used_session" };
    }

    const result = await clipboardManager.captureInsertionTarget();
    if (!result?.success || !result.target) {
      return { success: false, reason: result?.reason || "capture_failed" };
    }

    return {
      success: true,
      target: clipboardManager.issueInsertionTargetCapability(result.target, {
        ownerId: event.sender.id,
        sessionId: normalizedSessionId,
      }),
    };
  });

  ipcMain.handle("check-paste-tools", async (event) => {
    requireTrustedRenderer(event, windowManager);
    return clipboardManager.checkPasteTools();
  });

  ipcMain.handle("check-accessibility-permission", async (event) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    return clipboardManager.checkAccessibilityPermissions();
  });
}

module.exports = { registerClipboardHandlers };
