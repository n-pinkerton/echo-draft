const DevServerManager = require("../devServerManager");
const { isLiveWindow } = require("./windowUtils");

// Extract the session verifier from the deep link and navigate the control
// panel to its app URL with the verifier param so the Neon Auth SDK can
// read it from window.location.search and complete authentication.
function navigateControlPanelWithVerifier({
  windowManager,
  verifier,
  appChannel,
  oauthProtocol,
  debugLogger,
} = {}) {
  if (!verifier) return;
  if (!windowManager) return;
  if (!isLiveWindow(windowManager.controlPanelWindow)) return;

  const appUrl = DevServerManager.getAppUrl(true);

  if (appUrl) {
    const separator = appUrl.includes("?") ? "&" : "?";
    const urlWithVerifier = `${appUrl}${separator}neon_auth_session_verifier=${encodeURIComponent(verifier)}`;
    windowManager.controlPanelWindow.loadURL(urlWithVerifier);
  } else {
    const fileInfo = DevServerManager.getAppFilePath(true);
    if (!fileInfo) return;
    fileInfo.query.neon_auth_session_verifier = verifier;
    windowManager.controlPanelWindow.loadFile(fileInfo.path, { query: fileInfo.query });
  }

  if (debugLogger) {
    debugLogger.debug("Navigating control panel with OAuth verifier", {
      appChannel,
      oauthProtocol,
    });
  }
  windowManager.controlPanelWindow.show();
  windowManager.controlPanelWindow.focus();
}

function handleOAuthDeepLink({
  deepLinkUrl,
  windowManager,
  appChannel,
  oauthProtocol,
  debugLogger,
} = {}) {
  try {
    const parsed = new URL(deepLinkUrl);
    const verifier = parsed.searchParams.get("neon_auth_session_verifier");
    if (!verifier) return;

    navigateControlPanelWithVerifier({
      windowManager,
      verifier,
      appChannel,
      oauthProtocol,
      debugLogger,
    });
  } catch (err) {
    if (debugLogger) debugLogger.error("Failed to handle OAuth deep link:", err);
  }
}

module.exports = {
  handleOAuthDeepLink,
  navigateControlPanelWithVerifier,
};

