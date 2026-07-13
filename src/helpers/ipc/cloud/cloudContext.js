const MAX_CONFIGURED_URL_LENGTH = 2048;
const MAX_AUTH_COOKIE_VALUE_LENGTH = 8192;

const SESSION_COOKIE_NAMES = new Set([
  "__Secure-neon-auth.session_token",
  "__Host-neon-auth.session_token",
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
  "__Host-better-auth.session_token",
]);

const AUTH_COOKIE_NAMES = new Set([
  ...SESSION_COOKIE_NAMES,
  "__Secure-neon-auth.session_challange",
  "__Secure-neon-auth.session_challenge",
  "better-auth.session_data",
  "__Secure-better-auth.session_data",
  "__Host-better-auth.session_data",
  "better-auth.account_data",
  "__Secure-better-auth.account_data",
  "__Host-better-auth.account_data",
  "better-auth.dont_remember",
  "__Secure-better-auth.dont_remember",
  "__Host-better-auth.dont_remember",
]);

function normalizeConfiguredHttpsUrl(value, label = "Cloud service URL") {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return "";
  if (candidate.length > MAX_CONFIGURED_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(candidate)) {
    throw new Error(`${label} is invalid`);
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${label} is invalid`);
  }

  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must be a credential-free HTTPS URL`);
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function buildCloudRequestUrl(apiUrl, endpoint) {
  const base = normalizeConfiguredHttpsUrl(apiUrl, "EchoDraft API URL");
  if (!base) throw new Error("EchoDraft API URL not configured");
  if (
    typeof endpoint !== "string" ||
    !/^\/[A-Za-z0-9/_-]*$/.test(endpoint) ||
    endpoint.startsWith("//") ||
    endpoint.includes("..")
  ) {
    throw new Error("Cloud API endpoint is invalid");
  }

  const requestUrl = new URL(`${base}${endpoint}`);
  const baseUrl = new URL(base);
  if (requestUrl.origin !== baseUrl.origin) {
    throw new Error("Cloud API endpoint changed origin");
  }
  return requestUrl.toString();
}

function validateCookieValue(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_AUTH_COOKIE_VALUE_LENGTH &&
    !/[\u0000-\u0020\u007f;,]/.test(value)
  );
}

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
    normalizeConfiguredHttpsUrl(
      process.env.OPENWHISPR_API_URL ||
        process.env.VITE_OPENWHISPR_API_URL ||
        runtimeEnv.VITE_OPENWHISPR_API_URL ||
        "",
      "EchoDraft API URL"
    );

  const getAuthUrl = () =>
    normalizeConfiguredHttpsUrl(
      process.env.NEON_AUTH_URL ||
        process.env.VITE_NEON_AUTH_URL ||
        runtimeEnv.VITE_NEON_AUTH_URL ||
        "",
      "EchoDraft authentication URL"
    );

  const getCookieStore = (event) => {
    const win = BrowserWindow.fromWebContents(event?.sender);
    return win && !win.isDestroyed?.() ? win.webContents?.session?.cookies : null;
  };

  const getAllowedCookiesForUrl = async (event, requestUrl, allowedNames) => {
    const cookies = getCookieStore(event);
    if (!cookies) return [];
    const scopedCookies = await cookies.get({ url: requestUrl });
    return scopedCookies.filter(
      (cookie) => allowedNames.has(cookie?.name) && validateCookieValue(cookie?.value)
    );
  };

  const getSessionCookies = async (event, requestUrl) => {
    const apiUrl = getApiUrl();
    const normalizedRequestUrl = normalizeConfiguredHttpsUrl(requestUrl, "Cloud request URL");
    if (!normalizedRequestUrl) throw new Error("Cloud request URL is required");

    const api = new URL(apiUrl);
    const request = new URL(normalizedRequestUrl);
    const apiPath = api.pathname.replace(/\/$/, "");
    if (
      request.origin !== api.origin ||
      (apiPath && request.pathname !== apiPath && !request.pathname.startsWith(`${apiPath}/`))
    ) {
      throw new Error("Cloud request URL is outside the configured API boundary");
    }

    const scopedCookies = await getAllowedCookiesForUrl(
      event,
      normalizedRequestUrl,
      SESSION_COOKIE_NAMES
    );
    const cookiesByName = new Map();
    for (const cookie of scopedCookies) {
      if (cookiesByName.has(cookie.name)) {
        throw new Error("Ambiguous cloud authentication cookies");
      }
      cookiesByName.set(cookie.name, cookie.value);
    }

    debugLogger.debug(
      "Resolved scoped authentication for cloud request",
      { cookieCount: cookiesByName.size, requestOrigin: request.origin },
      "auth"
    );

    return [...cookiesByName.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  };

  const clearAuthSessionCookies = async (event) => {
    const cookies = getCookieStore(event);
    if (!cookies) return 0;

    const configuredUrls = [getAuthUrl(), getApiUrl()].filter(Boolean);
    const removals = new Set();
    for (const url of configuredUrls) {
      const scopedCookies = await getAllowedCookiesForUrl(event, url, AUTH_COOKIE_NAMES);
      for (const cookie of scopedCookies) {
        removals.add(`${url}\n${cookie.name}`);
      }
    }

    await Promise.all(
      [...removals].map((entry) => {
        const separator = entry.indexOf("\n");
        return cookies.remove(entry.slice(0, separator), entry.slice(separator + 1));
      })
    );
    return removals.size;
  };

  return {
    runtimeEnv,
    getApiUrl,
    getAuthUrl,
    getSessionCookies,
    clearAuthSessionCookies,
  };
}

module.exports = {
  AUTH_COOKIE_NAMES,
  MAX_CONFIGURED_URL_LENGTH,
  SESSION_COOKIE_NAMES,
  buildCloudRequestUrl,
  createCloudContext,
  normalizeConfiguredHttpsUrl,
};
