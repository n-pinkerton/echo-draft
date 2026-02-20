function installNeonAuthOriginFix(electronSession) {
  // Electron's file:// sends no Origin header, which Neon Auth rejects.
  // Inject the request's own origin at the Chromium network layer.
  electronSession.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://*.neon.tech/*"] },
    (details, callback) => {
      try {
        details.requestHeaders["Origin"] = new URL(details.url).origin;
      } catch {
        /* malformed URL — leave Origin as-is */
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

module.exports = {
  installNeonAuthOriginFix,
};

