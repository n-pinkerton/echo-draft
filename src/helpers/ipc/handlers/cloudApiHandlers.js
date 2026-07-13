const debugLogger = require("../../debugLogger");

const CLOUD_CLEANUP_MODELS = new Set(["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol"]);
const SAFE_METADATA_TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

const normalizeCleanupModel = (value) => {
  const model = typeof value === "string" ? value.trim() : "";
  return CLOUD_CLEANUP_MODELS.has(model) ? model : null;
};

const normalizeMetadataToken = (value) => {
  const token = typeof value === "string" ? value.trim() : "";
  return SAFE_METADATA_TOKEN.test(token) ? token : undefined;
};

const finiteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function registerCloudApiHandlers(
  { ipcMain, app, http, https, shell },
  { cloudContext, sessionId, whisperManager, cancelableRequests }
) {
  const { getApiUrl, getSessionCookies } = cloudContext;
  const throwIfCancelled = (signal) => {
    if (!signal?.aborted) return;
    const error = new Error("Request cancelled");
    error.name = "AbortError";
    error.code = "REQUEST_CANCELLED";
    throw error;
  };
  const cancelledResult = { success: false, error: "Request cancelled", code: "REQUEST_CANCELLED" };

  ipcMain.handle("cloud-transcribe", async (event, audioBuffer, opts = {}, requestId) => {
    let requestScope;
    try {
      requestScope = cancelableRequests.createScope(event, requestId);
      const { signal } = requestScope;
      throwIfCancelled(signal);
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("EchoDraft API URL not configured");

      const cookieHeader = await getSessionCookies(event);
      throwIfCancelled(signal);
      if (!cookieHeader) throw new Error("No session cookies available");

      const audioData = Buffer.from(audioBuffer);
      const boundary = `----EchoDraft${Date.now()}`;
      const parts = [];

      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
          `Content-Type: audio/webm\r\n\r\n`
      );
      parts.push(audioData);
      parts.push("\r\n");

      if (opts.language) {
        parts.push(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="language"\r\n\r\n` +
            `${opts.language}\r\n`
        );
      }

      if (opts.prompt) {
        parts.push(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="prompt"\r\n\r\n` +
            `${opts.prompt}\r\n`
        );
      }

      // Add client metadata for logging
      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="clientType"\r\n\r\n` +
          `desktop\r\n`
      );

      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="appVersion"\r\n\r\n` +
          `${app.getVersion()}\r\n`
      );

      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="sessionId"\r\n\r\n` +
          `${sessionId}\r\n`
      );

      parts.push(`--${boundary}--\r\n`);

      const bodyParts = parts.map((p) => (typeof p === "string" ? Buffer.from(p) : p));
      const body = Buffer.concat(bodyParts);

      debugLogger.debug(
        "Cloud transcribe request",
        { audioSize: audioData.length, bodySize: body.length },
        "cloud-api"
      );

      const url = new URL(`${apiUrl}/api/transcribe`);
      const httpModule = url.protocol === "https:" ? https : http;

      const data = await new Promise((resolve, reject) => {
        const req = httpModule.request(
          {
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname,
            method: "POST",
            headers: {
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
              "Content-Length": body.length,
              Cookie: cookieHeader,
            },
          },
          (res) => {
            let responseData = "";
            res.on("data", (chunk) => {
              responseData += chunk;
              if (responseData.length > 10 * 1024 * 1024) {
                req.destroy(new Error("Cloud transcription response exceeded 10 MB"));
              }
            });
            res.on("end", () => {
              if (signal.aborted) {
                reject(Object.assign(new Error("Request cancelled"), { name: "AbortError" }));
                return;
              }
              try {
                const parsed = JSON.parse(responseData);
                resolve({ statusCode: res.statusCode, data: parsed });
              } catch {
                reject(new Error(`Invalid JSON response (${responseData.length} bytes)`));
              }
            });
          }
        );
        const handleAbort = () => {
          req.destroy(Object.assign(new Error("Request cancelled"), { name: "AbortError" }));
        };
        signal.addEventListener("abort", handleAbort, { once: true });
        req.on("error", reject);
        req.on("close", () => signal.removeEventListener("abort", handleAbort));
        if (signal.aborted) {
          handleAbort();
          return;
        }
        req.write(body);
        req.end();
      });

      debugLogger.debug("Cloud transcribe response", { statusCode: data.statusCode }, "cloud-api");

      if (data.statusCode === 401) {
        return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
      }
      if (data.statusCode === 429) {
        return {
          success: false,
          error: "Daily word limit reached",
          code: "LIMIT_REACHED",
          limitReached: true,
          wordsUsed: finiteNumber(data.data?.wordsUsed),
          wordsRemaining: finiteNumber(data.data?.wordsRemaining),
          plan: normalizeMetadataToken(data.data?.plan),
        };
      }
      if (data.statusCode !== 200) {
        throw new Error(`Cloud transcription failed (HTTP ${data.statusCode}).`);
      }
      if (typeof data.data?.text !== "string") {
        throw new Error("Cloud transcription returned an invalid response");
      }

      return {
        success: true,
        text: data.data.text,
        wordsUsed: finiteNumber(data.data?.wordsUsed),
        wordsRemaining: finiteNumber(data.data?.wordsRemaining),
        plan: normalizeMetadataToken(data.data?.plan),
        limitReached: data.data?.limitReached === true,
      };
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "REQUEST_CANCELLED") {
        debugLogger.info("Cloud transcription cancelled", {}, "cloud-api");
        return cancelledResult;
      }
      debugLogger.error("Cloud transcription error", { error: error.message }, "cloud-api");
      return { success: false, error: error.message };
    } finally {
      requestScope?.finish();
    }
  });

  ipcMain.handle("cloud-reason", async (event, text, opts = {}, requestId) => {
    let requestScope;
    try {
      requestScope = cancelableRequests.createScope(event, requestId);
      const { signal } = requestScope;
      throwIfCancelled(signal);
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("EchoDraft API URL not configured");
      const requestedModel = normalizeCleanupModel(opts.model);
      if (opts.model && !requestedModel) {
        throw new Error("Unsupported EchoDraft cloud cleanup model");
      }

      debugLogger.debug(
        "cloud-reason request",
        {
          model: requestedModel,
          agentNamePresent: Boolean(opts.agentName),
          agentNameLength: typeof opts.agentName === "string" ? opts.agentName.length : 0,
          language: normalizeMetadataToken(opts.language),
          textLength: text?.length || 0,
        },
        "cloud-api"
      );

      const cookieHeader = await getSessionCookies(event);
      throwIfCancelled(signal);
      if (!cookieHeader) throw new Error("No session cookies available");

      const fetchStart = Date.now();
      const response = await fetch(`${apiUrl}/api/reason`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          text,
          model: requestedModel || undefined,
          agentName: opts.agentName,
          customDictionary: opts.customDictionary,
          language: opts.language,
          sessionId,
          clientType: "desktop",
          appVersion: app.getVersion(),
        }),
        signal,
      });
      throwIfCancelled(signal);
      const fetchMs = Date.now() - fetchStart;

      debugLogger.debug(
        "cloud-reason response",
        { status: response.status, ok: response.ok, fetchMs },
        "cloud-api"
      );

      if (!response.ok) {
        if (response.status === 401) {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        throw new Error(`Cloud reasoning failed (HTTP ${response.status}).`);
      }

      const data = await response.json();
      if (typeof data?.text !== "string") {
        throw new Error("Cloud reasoning returned an invalid response");
      }
      return {
        success: true,
        text: data.text,
        model: requestedModel,
        provider: requestedModel ? "openai" : "echodraft-cloud",
      };
    } catch (error) {
      if (error?.name === "AbortError" || error?.code === "REQUEST_CANCELLED") {
        debugLogger.info("Cloud reasoning cancelled", {}, "cloud-api");
        return cancelledResult;
      }
      debugLogger.error("Cloud reasoning error", { error: error.message }, "cloud-api");
      return { success: false, error: error.message };
    } finally {
      requestScope?.finish();
    }
  });

  ipcMain.handle("cloud-usage", async (event) => {
    try {
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("EchoDraft API URL not configured");

      const cookieHeader = await getSessionCookies(event);
      if (!cookieHeader) throw new Error("No session cookies available");

      const response = await fetch(`${apiUrl}/api/usage`, {
        headers: { Cookie: cookieHeader },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();
      return { success: true, ...data };
    } catch (error) {
      debugLogger.error("Cloud usage fetch error:", error);
      return { success: false, error: error.message };
    }
  });

  const fetchStripeUrl = async (event, endpoint, errorPrefix) => {
    try {
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("EchoDraft API URL not configured");

      const cookieHeader = await getSessionCookies(event);
      if (!cookieHeader) throw new Error("No session cookies available");

      const response = await fetch(`${apiUrl}${endpoint}`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const data = await response.json();
      return { success: true, url: data.url };
    } catch (error) {
      debugLogger.error(`${errorPrefix}: ${error.message}`);
      return { success: false, error: error.message };
    }
  };

  ipcMain.handle("cloud-checkout", (event) =>
    fetchStripeUrl(event, "/api/stripe/checkout", "Cloud checkout error")
  );

  ipcMain.handle("cloud-billing-portal", (event) =>
    fetchStripeUrl(event, "/api/stripe/portal", "Cloud billing portal error")
  );

  ipcMain.handle("open-whisper-models-folder", async () => {
    try {
      const modelsDir = whisperManager.getModelsDir();
      await shell.openPath(modelsDir);
      return { success: true };
    } catch (error) {
      debugLogger.error("Failed to open whisper models folder:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerCloudApiHandlers };
