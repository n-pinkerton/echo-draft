const http = require("http");

const DEFAULT_AUTH_BRIDGE_HOST = "127.0.0.1";
const DEFAULT_AUTH_BRIDGE_PATH = "/oauth/callback";

function parseJsonBody(req, { maxBytes = 32 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += bytes.length;
      if (receivedBytes > maxBytes) {
        settled = true;
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(bytes);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function isAllowedBridgeOrigin({ method, origin, expectedOrigin }) {
  if (typeof expectedOrigin !== "string" || !expectedOrigin) return false;
  if (origin) return origin === expectedOrigin;
  return method === "GET";
}

function isExactHttpOrigin(value) {
  try {
    const parsed = new URL(String(value || ""));
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

function writeCorsHeaders(res, expectedOrigin) {
  res.setHeader("Access-Control-Allow-Origin", expectedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function startAuthBridgeServer({
  channel,
  host = DEFAULT_AUTH_BRIDGE_HOST,
  port,
  path = DEFAULT_AUTH_BRIDGE_PATH,
  expectedOrigin,
  debugLogger,
  onVerifier,
} = {}) {
  if (channel !== "development") {
    return null;
  }

  if (typeof onVerifier !== "function") {
    throw new Error("startAuthBridgeServer requires an onVerifier callback");
  }

  if (!isExactHttpOrigin(expectedOrigin)) {
    throw new Error("startAuthBridgeServer requires an exact expected development origin");
  }

  const server = http.createServer(async (req, res) => {
    const method = req.method || "";
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    if (!isAllowedBridgeOrigin({ method, origin, expectedOrigin })) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }
    writeCorsHeaders(res, expectedOrigin);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "GET" && req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8", Allow: "GET, POST" });
      res.end("Method not allowed");
      return;
    }

    const expectedHost = `${host}:${port}`;
    if (req.headers.host !== expectedHost) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid host");
      return;
    }

    const requestUrl = new URL(req.url || "/", `http://${host}:${port}`);
    if (requestUrl.pathname !== path) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    let verifier = requestUrl.searchParams.get("neon_auth_session_verifier");
    let state = requestUrl.searchParams.get("oauth_state");
    const queryKeys = [...requestUrl.searchParams.keys()];
    if (
      queryKeys.some((key) => key !== "neon_auth_session_verifier" && key !== "oauth_state") ||
      requestUrl.searchParams.getAll("neon_auth_session_verifier").length > 1 ||
      requestUrl.searchParams.getAll("oauth_state").length > 1
    ) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid callback parameters");
      return;
    }
    if (!verifier && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        const bodyKeys =
          body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).sort() : [];
        if (bodyKeys.join("\0") !== "neon_auth_session_verifier\0oauth_state") {
          throw new Error("Invalid callback payload");
        }
        verifier = body.neon_auth_session_verifier || null;
        state = body.oauth_state || null;
      } catch (error) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Invalid request");
        return;
      }
    }

    if (!verifier || !state) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Missing callback parameters");
      return;
    }

    let accepted = false;
    try {
      accepted = await onVerifier(verifier, state);
    } catch {
      accepted = false;
    }
    if (!accepted) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("OAuth callback rejected");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<html><body><h3>EchoDraft sign-in complete.</h3><p>You can close this tab.</p></body></html>"
    );
  });

  server.on("error", (error) => {
    if (debugLogger) {
      debugLogger.error("OAuth auth bridge server failed:", error);
    }
  });

  server.listen(port, host, () => {
    if (debugLogger) {
      debugLogger.debug("OAuth auth bridge server started", {
        url: `http://${host}:${port}${path}`,
      });
    }
  });

  return server;
}

module.exports = {
  DEFAULT_AUTH_BRIDGE_HOST,
  DEFAULT_AUTH_BRIDGE_PATH,
  parseJsonBody,
  isAllowedBridgeOrigin,
  isExactHttpOrigin,
  startAuthBridgeServer,
  writeCorsHeaders,
};
