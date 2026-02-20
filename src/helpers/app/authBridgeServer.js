const http = require("http");

const DEFAULT_AUTH_BRIDGE_HOST = "127.0.0.1";
const DEFAULT_AUTH_BRIDGE_PATH = "/oauth/callback";

function parseJsonBody(req, { maxBytes = 32 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

function writeCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function startAuthBridgeServer({
  channel,
  host = DEFAULT_AUTH_BRIDGE_HOST,
  port,
  path = DEFAULT_AUTH_BRIDGE_PATH,
  debugLogger,
  onVerifier,
} = {}) {
  if (channel !== "development") {
    return null;
  }

  if (typeof onVerifier !== "function") {
    throw new Error("startAuthBridgeServer requires an onVerifier callback");
  }

  const server = http.createServer(async (req, res) => {
    writeCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const requestUrl = new URL(req.url || "/", `http://${host}:${port}`);
    if (requestUrl.pathname !== path) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    let verifier = requestUrl.searchParams.get("neon_auth_session_verifier");
    if (!verifier && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        verifier = body?.neon_auth_session_verifier || body?.verifier || null;
      } catch (error) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Invalid request");
        return;
      }
    }

    if (!verifier) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Missing neon_auth_session_verifier");
      return;
    }

    onVerifier(verifier);

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
  startAuthBridgeServer,
  writeCorsHeaders,
};

