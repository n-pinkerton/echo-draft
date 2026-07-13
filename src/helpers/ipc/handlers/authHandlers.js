const debugLogger = require("../../debugLogger");
const { normalizeExternalHttpsUrl } = require("../../externalUrl");
const { requireTrustedRenderer } = require("../trustedRenderer");

const MAX_OAUTH_RESPONSE_BYTES = 64 * 1024;
const MAX_OAUTH_CALLBACK_CHARS = 2048;
const OAUTH_REQUEST_TIMEOUT_MS = 30_000;
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const logOAuthFailure = (status, category) => {
  debugLogger.error("Social sign-in initiation failed", { status, category }, "auth");
};

const readBoundedOAuthResponse = async (response) => {
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined) {
    const parsedLength = /^\d+$/.test(declaredLength) ? Number(declaredLength) : Number.NaN;
    if (!Number.isSafeInteger(parsedLength) || parsedLength > MAX_OAUTH_RESPONSE_BYTES) {
      throw Object.assign(new Error("OAuth response exceeded its safety limit"), {
        code: "OAUTH_RESPONSE_TOO_LARGE",
      });
    }
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    throw Object.assign(new Error("OAuth response body was unavailable"), {
      code: "OAUTH_RESPONSE_UNREADABLE",
    });
  }

  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array)) {
      await reader.cancel?.().catch?.(() => undefined);
      throw Object.assign(new Error("OAuth response body was invalid"), {
        code: "OAUTH_RESPONSE_UNREADABLE",
      });
    }
    totalBytes += value.byteLength;
    if (totalBytes > MAX_OAUTH_RESPONSE_BYTES) {
      await reader.cancel?.().catch?.(() => undefined);
      throw Object.assign(new Error("OAuth response exceeded its safety limit"), {
        code: "OAUTH_RESPONSE_TOO_LARGE",
      });
    }
    chunks.push(value);
  }

  const bytes = Buffer.allocUnsafe(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    Buffer.from(chunk).copy(bytes, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw Object.assign(new Error("OAuth response was not valid UTF-8"), {
      code: "OAUTH_RESPONSE_UNREADABLE",
    });
  }
};

const parseOAuthUrl = (text) => {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Object.assign(new Error("OAuth response was not valid JSON"), {
      code: "OAUTH_RESPONSE_INVALID_JSON",
    });
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    typeof parsed.url !== "string"
  ) {
    throw Object.assign(new Error("OAuth response schema was invalid"), {
      code: "OAUTH_RESPONSE_INVALID_SCHEMA",
    });
  }
  try {
    return normalizeExternalHttpsUrl(parsed.url);
  } catch {
    throw Object.assign(new Error("OAuth authorization URL was invalid"), {
      code: "OAUTH_RESPONSE_INVALID_URL",
    });
  }
};

const normalizeOAuthCallbackBase = (value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > MAX_OAUTH_CALLBACK_CHARS || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error("OAuth callback URL is invalid");
  }
  const parsed = new URL(raw);
  const isLoopbackHttp = parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !isLoopbackHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error("OAuth callback URL is outside the trusted boundary");
  }
  return parsed;
};

const buildOAuthCallbackUrl = (event, state, cloudContext) => {
  if (!OAUTH_STATE_PATTERN.test(state)) throw new Error("OAuth state is invalid");
  const configured =
    process.env.OPENWHISPR_OAUTH_CALLBACK_URL ||
    process.env.VITE_OPENWHISPR_OAUTH_CALLBACK_URL ||
    cloudContext?.runtimeEnv?.VITE_OPENWHISPR_OAUTH_CALLBACK_URL ||
    "";

  let callback;
  if (configured) {
    callback = normalizeOAuthCallbackBase(configured);
  } else {
    const senderUrl = new URL(event.sender.getURL());
    if (senderUrl.protocol === "file:") {
      const port =
        process.env.VITE_DEV_SERVER_PORT ||
        cloudContext?.runtimeEnv?.VITE_DEV_SERVER_PORT ||
        "5183";
      if (!/^\d{2,5}$/.test(String(port))) throw new Error("OAuth callback port is invalid");
      callback = normalizeOAuthCallbackBase(`http://localhost:${port}/?panel=true`);
    } else {
      callback = normalizeOAuthCallbackBase(`${senderUrl.origin}/?panel=true`);
    }
  }
  callback.searchParams.set("oauth_state", state);
  return callback.toString();
};

const buildSocialSignInEndpoint = (authUrl) => {
  const base = new URL(authUrl);
  const endpoint = new URL(`${authUrl.replace(/\/+$/, "")}/sign-in/social`);
  const basePath = base.pathname.replace(/\/+$/, "");
  if (
    endpoint.protocol !== "https:" ||
    endpoint.origin !== base.origin ||
    (basePath && !endpoint.pathname.startsWith(`${basePath}/`))
  ) {
    throw new Error("Authentication endpoint is outside the configured boundary");
  }
  return endpoint.toString();
};

function registerAuthHandlers({ ipcMain, shell }, { cloudContext, windowManager }) {
  ipcMain.handle("auth-clear-session", async (event) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    try {
      await cloudContext.clearAuthSessionCookies(event);
      return { success: true };
    } catch (error) {
      debugLogger.error("Failed to clear auth session:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("auth-begin-social-sign-in", async (event, request) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    if (
      !request ||
      typeof request !== "object" ||
      Array.isArray(request) ||
      request.provider !== "google" ||
      !OAUTH_STATE_PATTERN.test(request.state || "")
    ) {
      return { success: false, error: "Failed to create a secure sign-in session" };
    }

    let status = 0;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OAUTH_REQUEST_TIMEOUT_MS);
    timeoutId.unref?.();
    try {
      const authUrl = cloudContext.getAuthUrl();
      if (!authUrl) return { success: false, error: "Auth not configured" };
      const endpoint = buildSocialSignInEndpoint(authUrl);
      const callbackURL = buildOAuthCallbackUrl(event, request.state, cloudContext);
      const sessionFetch = event.sender?.session?.fetch;
      if (typeof sessionFetch !== "function") {
        throw Object.assign(new Error("Renderer session transport is unavailable"), {
          code: "OAUTH_TRANSPORT_UNAVAILABLE",
        });
      }

      const response = await sessionFetch.call(event.sender.session, endpoint, {
        method: "POST",
        redirect: "manual",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: request.provider,
          callbackURL,
          disableRedirect: true,
        }),
        signal: controller.signal,
      });
      status = Number(response?.status) || 0;
      if (status >= 300 && status < 400) {
        logOAuthFailure(status, "redirect");
        return { success: false, error: "Failed to initiate sign-in" };
      }
      if (!response?.ok) {
        logOAuthFailure(status, "http_status");
        return { success: false, error: "Failed to initiate sign-in" };
      }

      let responseText;
      try {
        responseText = await readBoundedOAuthResponse(response);
      } catch (error) {
        logOAuthFailure(
          status,
          error?.code === "OAUTH_RESPONSE_TOO_LARGE" ? "response_too_large" : "response_unreadable"
        );
        return { success: false, error: "Unexpected response from auth server" };
      }

      let authorizationUrl;
      try {
        authorizationUrl = parseOAuthUrl(responseText);
      } catch (error) {
        const category =
          error?.code === "OAUTH_RESPONSE_INVALID_JSON"
            ? "invalid_json"
            : error?.code === "OAUTH_RESPONSE_INVALID_SCHEMA"
              ? "invalid_schema"
              : "invalid_url";
        logOAuthFailure(status, category);
        return { success: false, error: "Unexpected response from auth server" };
      }

      await shell.openExternal(authorizationUrl);
      return { success: true };
    } catch (error) {
      logOAuthFailure(status, error?.name === "AbortError" ? "timeout" : "transport");
      return { success: false, error: "Failed to initiate sign-in" };
    } finally {
      clearTimeout(timeoutId);
    }
  });
}

module.exports = {
  MAX_OAUTH_RESPONSE_BYTES,
  OAUTH_REQUEST_TIMEOUT_MS,
  buildOAuthCallbackUrl,
  buildSocialSignInEndpoint,
  parseOAuthUrl,
  readBoundedOAuthResponse,
  registerAuthHandlers,
};
