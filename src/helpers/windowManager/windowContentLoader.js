const DevServerManager = require("../devServerManager");
const { pathToFileURL } = require("url");

/**
 * Load renderer content into a BrowserWindow, handling dev-server vs production file loading.
 * @param {{ window: any, isControlPanel?: boolean }} params
 */
async function loadWindowContent({ window, isControlPanel = false } = {}) {
  if (!window || window.isDestroyed?.()) {
    throw new Error("loadWindowContent: window is not available");
  }

  if (process.env.NODE_ENV === "development") {
    const appUrl = DevServerManager.getAppUrl(isControlPanel);
    window.__echoDraftTrustedUrl = appUrl;
    await DevServerManager.waitForDevServer();
    await window.loadURL(appUrl);
    return;
  }

  // Production: use loadFile() for better compatibility with Electron 36+
  const fileInfo = DevServerManager.getAppFilePath(isControlPanel);
  if (!fileInfo) {
    throw new Error("Failed to get app file path");
  }

  const fs = require("fs");
  if (!fs.existsSync(fileInfo.path)) {
    throw new Error(`HTML file not found: ${fileInfo.path}`);
  }

  const trustedUrl = pathToFileURL(fileInfo.path);
  for (const [key, value] of Object.entries(fileInfo.query || {})) {
    trustedUrl.searchParams.set(key, String(value));
  }
  window.__echoDraftTrustedUrl = trustedUrl.toString();

  await window.loadFile(fileInfo.path, { query: fileInfo.query });
}

module.exports = {
  loadWindowContent,
};
