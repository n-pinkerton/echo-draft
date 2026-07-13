const DevServerManager = require("../devServerManager");
const { pathToFileURL } = require("url");
const { isLiveWindow } = require("./windowUtils");
const { isValidOAuthState } = require("./oauthState");

const OAUTH_VERIFIER_PATTERN = /^[A-Za-z0-9._~+/=-]{16,2048}$/;

function isValidOAuthVerifier(value) {
  return typeof value === "string" && OAUTH_VERIFIER_PATTERN.test(value);
}

function parseOAuthCallbackUrl(deepLinkUrl, oauthProtocol) {
  if (
    typeof deepLinkUrl !== "string" ||
    deepLinkUrl.length > 4096 ||
    typeof oauthProtocol !== "string" ||
    !/^[a-z][a-z0-9+.-]{1,63}$/.test(oauthProtocol)
  ) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(deepLinkUrl);
  } catch {
    return null;
  }

  const keys = [...parsed.searchParams.keys()];
  if (
    parsed.protocol !== `${oauthProtocol}:` ||
    parsed.hostname !== "auth" ||
    parsed.pathname !== "/callback" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    keys.length !== 2 ||
    keys.some((key) => key !== "neon_auth_session_verifier" && key !== "oauth_state") ||
    parsed.searchParams.getAll("neon_auth_session_verifier").length !== 1 ||
    parsed.searchParams.getAll("oauth_state").length !== 1
  ) {
    return null;
  }

  const verifier = parsed.searchParams.get("neon_auth_session_verifier");
  const state = parsed.searchParams.get("oauth_state");
  if (!isValidOAuthVerifier(verifier) || !isValidOAuthState(state)) return null;
  return { verifier, state };
}

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
  if (!isValidOAuthVerifier(verifier)) return false;
  if (!windowManager) return false;
  if (!isLiveWindow(windowManager.controlPanelWindow)) return false;

  const appUrl = DevServerManager.getAppUrl(true);

  if (appUrl) {
    const separator = appUrl.includes("?") ? "&" : "?";
    const urlWithVerifier = `${appUrl}${separator}neon_auth_session_verifier=${encodeURIComponent(verifier)}`;
    windowManager.controlPanelWindow.__echoDraftTrustedUrl = urlWithVerifier;
    windowManager.controlPanelWindow.loadURL(urlWithVerifier);
  } else {
    const fileInfo = DevServerManager.getAppFilePath(true);
    if (!fileInfo) return false;
    fileInfo.query.neon_auth_session_verifier = verifier;
    const trustedUrl = pathToFileURL(fileInfo.path);
    for (const [key, value] of Object.entries(fileInfo.query)) {
      trustedUrl.searchParams.set(key, String(value));
    }
    windowManager.controlPanelWindow.__echoDraftTrustedUrl = trustedUrl.toString();
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
  return true;
}

function acceptOAuthCallback({
  verifier,
  state,
  windowManager,
  oauthStateManager,
  appChannel,
  oauthProtocol,
  debugLogger,
} = {}) {
  if (!isValidOAuthVerifier(verifier) || !isValidOAuthState(state)) return false;
  if (!isLiveWindow(windowManager?.controlPanelWindow)) return false;
  const rendererId = windowManager.controlPanelWindow.webContents?.id;
  const consumed = oauthStateManager?.consume?.({ state, rendererId });
  if (!consumed?.accepted) {
    debugLogger?.warn?.("Rejected OAuth callback", { reason: consumed?.reason || "invalid" });
    return false;
  }

  return navigateControlPanelWithVerifier({
    windowManager,
    verifier,
    appChannel,
    oauthProtocol,
    debugLogger,
  });
}

function handleOAuthDeepLink({
  deepLinkUrl,
  windowManager,
  appChannel,
  oauthProtocol,
  oauthStateManager,
  debugLogger,
} = {}) {
  try {
    const callback = parseOAuthCallbackUrl(deepLinkUrl, oauthProtocol);
    if (!callback) return false;

    return acceptOAuthCallback({
      windowManager,
      oauthStateManager,
      verifier: callback.verifier,
      state: callback.state,
      appChannel,
      oauthProtocol,
      debugLogger,
    });
  } catch (err) {
    if (debugLogger) debugLogger.error("Failed to handle OAuth deep link:", err);
    return false;
  }
}

module.exports = {
  acceptOAuthCallback,
  handleOAuthDeepLink,
  isValidOAuthVerifier,
  navigateControlPanelWithVerifier,
  parseOAuthCallbackUrl,
};
