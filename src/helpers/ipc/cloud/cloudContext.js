function createCloudContext({ helpersDir, fs, path, BrowserWindow, debugLogger }) {
  // In production, VITE_* env vars aren't available in the main process because
  // Vite only inlines them into the renderer bundle at build time. Load the
  // runtime-env.json that the Vite build writes to src/dist/ as a fallback.
  const runtimeEnv = (() => {
    const envPath = path.join(helpersDir, "..", "dist", "runtime-env.json");
    try {
      if (fs.existsSync(envPath)) return JSON.parse(fs.readFileSync(envPath, "utf8"));
    } catch {}
    return {};
  })();

  const getApiUrl = () =>
    process.env.OPENWHISPR_API_URL ||
    process.env.VITE_OPENWHISPR_API_URL ||
    runtimeEnv.VITE_OPENWHISPR_API_URL ||
    "";

  const getAuthUrl = () =>
    process.env.NEON_AUTH_URL || process.env.VITE_NEON_AUTH_URL || runtimeEnv.VITE_NEON_AUTH_URL || "";

  const getSessionCookies = async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return "";

    const scopedUrls = [getAuthUrl(), getApiUrl()].filter(Boolean);
    const cookiesByName = new Map();

    for (const url of scopedUrls) {
      try {
        const scopedCookies = await win.webContents.session.cookies.get({ url });
        for (const cookie of scopedCookies) {
          if (!cookiesByName.has(cookie.name)) {
            cookiesByName.set(cookie.name, cookie.value);
          }
        }
      } catch (error) {
        debugLogger.warn("Failed to read scoped auth cookies", {
          url,
          error: error.message,
        });
      }
    }

    // Fallback for older sessions where cookies are not URL-scoped as expected.
    if (cookiesByName.size === 0) {
      const allCookies = await win.webContents.session.cookies.get({});
      for (const cookie of allCookies) {
        if (!cookiesByName.has(cookie.name)) {
          cookiesByName.set(cookie.name, cookie.value);
        }
      }
    }

    const cookieHeader = [...cookiesByName.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");

    debugLogger.debug(
      "Resolved auth cookies for cloud request",
      {
        cookieCount: cookiesByName.size,
        scopedUrls,
      },
      "auth"
    );

    return cookieHeader;
  };

  return {
    runtimeEnv,
    getApiUrl,
    getAuthUrl,
    getSessionCookies,
  };
}

module.exports = { createCloudContext };

