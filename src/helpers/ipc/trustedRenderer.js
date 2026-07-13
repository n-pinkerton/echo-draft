const normalizeDocumentUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
};

const isTrustedAppNavigation = (browserWindow, targetUrl) => {
  const expected = normalizeDocumentUrl(browserWindow?.__echoDraftTrustedUrl);
  const target = normalizeDocumentUrl(targetUrl);
  return Boolean(expected && target && expected === target);
};

const isMainFrameEvent = (event) => {
  if (!event?.sender || !event.senderFrame || !event.sender.mainFrame) return false;
  if (event.senderFrame === event.sender.mainFrame) return true;

  // Electron can surface distinct WebFrameMain wrapper objects for the same frame.
  // Compare both native identifiers when object identity is not stable; a subframe
  // has a different routing id and therefore still fails closed.
  const senderProcessId = Number(event.senderFrame.processId);
  const senderRoutingId = Number(event.senderFrame.routingId);
  const mainProcessId = Number(event.sender.mainFrame.processId);
  const mainRoutingId = Number(event.sender.mainFrame.routingId);
  return (
    Number.isInteger(senderProcessId) &&
    senderProcessId >= 0 &&
    Number.isInteger(senderRoutingId) &&
    senderRoutingId >= 0 &&
    senderProcessId === mainProcessId &&
    senderRoutingId === mainRoutingId
  );
};

const getTrustedRendererRole = (event, windowManager) => {
  if (!isMainFrameEvent(event)) return null;
  const candidates = [
    ["dictation", windowManager?.mainWindow],
    ["control-panel", windowManager?.controlPanelWindow],
  ];

  for (const [role, browserWindow] of candidates) {
    if (!browserWindow || browserWindow.isDestroyed?.()) continue;
    if (browserWindow.webContents !== event.sender) continue;
    const senderUrl = event.senderFrame?.url || event.sender.getURL?.() || "";
    if (!isTrustedAppNavigation(browserWindow, senderUrl)) return null;
    return role;
  }
  return null;
};

const requireTrustedRenderer = (
  event,
  windowManager,
  allowedRoles = ["dictation", "control-panel"]
) => {
  const role = getTrustedRendererRole(event, windowManager);
  if (!role || !allowedRoles.includes(role)) {
    const error = new Error("IPC request was rejected because the renderer is not trusted.");
    error.code = "UNTRUSTED_RENDERER";
    throw error;
  }
  return role;
};

module.exports = {
  getTrustedRendererRole,
  isMainFrameEvent,
  isTrustedAppNavigation,
  normalizeDocumentUrl,
  requireTrustedRenderer,
};
