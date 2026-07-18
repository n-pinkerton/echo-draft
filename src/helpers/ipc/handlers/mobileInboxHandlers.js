const { MAX_TODO_META_BYTES, MAX_TODO_TEXT_LENGTH, UUID_PATTERN } = require("../../todoPayload");
const { normalizeCleanupTitle } = require("../../../config/cleanupOutputContract.cjs");
const { requireTrustedRenderer } = require("../trustedRenderer");

const MAX_COMPLETION_METADATA_BYTES = Math.min(MAX_TODO_META_BYTES, 128 * 1024);

const cloneSmallObject = (value, label) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid mobile inbox ${label}`);
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > MAX_COMPLETION_METADATA_BYTES) {
    throw new Error(`Mobile inbox ${label} is too large`);
  }
  return JSON.parse(serialized);
};

const normalizeCompletionResult = (result) => {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Invalid mobile inbox completion");
  }
  if (result.success !== true) return { success: false };

  const text = typeof result.text === "string" ? result.text : "";
  if (!text.trim() || text.length > MAX_TODO_TEXT_LENGTH) {
    throw new Error("Invalid mobile inbox completion text");
  }
  const rawText = typeof result.rawText === "string" ? result.rawText : null;
  if (rawText && rawText.length > MAX_TODO_TEXT_LENGTH) {
    throw new Error("Mobile inbox raw text is too large");
  }
  const title = normalizeCleanupTitle(result.title);
  const source = typeof result.source === "string" ? result.source.slice(0, 128) : null;
  const provider = typeof result.provider === "string" ? result.provider.slice(0, 128) : null;
  const model = typeof result.model === "string" ? result.model.slice(0, 128) : null;
  const cleanup = cloneSmallObject(result.cleanup, "cleanup metadata");
  const timings = cloneSmallObject(result.timings, "timing metadata");

  return {
    success: true,
    text,
    ...(rawText ? { rawText } : {}),
    ...(title ? { title } : {}),
    ...(source ? { source } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(cleanup ? { cleanup } : {}),
    ...(timings ? { timings } : {}),
  };
};

function registerMobileInboxHandlers(
  { ipcMain, BrowserWindow, dialog },
  { mobileInboxManager, windowManager }
) {
  ipcMain.handle("mobile-inbox-get-status", async (event) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    return mobileInboxManager.getStatus();
  });

  ipcMain.handle("mobile-inbox-choose-folder", async (event) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    const result = await dialog.showOpenDialog(
      windowManager.controlPanelWindow || BrowserWindow.getFocusedWindow() || undefined,
      {
        title: "Choose the EchoDraft mobile sync folder",
        buttonLabel: "Use this folder",
        properties: ["openDirectory", "createDirectory"],
      }
    );
    if (result.canceled || !result.filePaths?.[0]) {
      return { success: false, canceled: true };
    }
    return {
      success: true,
      status: await mobileInboxManager.setInboxPath(result.filePaths[0]),
    };
  });

  ipcMain.handle("mobile-inbox-complete", async (event, requestId, result) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    const normalizedRequestId =
      typeof requestId === "string" ? requestId.trim().toLowerCase() : "";
    if (!UUID_PATTERN.test(normalizedRequestId)) {
      throw new Error("Invalid mobile inbox request ID");
    }
    return mobileInboxManager.completeRequest(
      normalizedRequestId,
      normalizeCompletionResult(result)
    );
  });

  ipcMain.handle("mobile-inbox-renderer-ready", async (event) => {
    requireTrustedRenderer(event, windowManager, ["dictation"]);
    return mobileInboxManager.markRendererReady();
  });
}

module.exports = {
  normalizeCompletionResult,
  registerMobileInboxHandlers,
};
