const debugLogger = require("../../debugLogger");

function registerCloudApiHandlers(
  { ipcMain, app, http, https, shell },
  { cloudContext, sessionId, whisperManager }
) {
  const { getApiUrl, getSessionCookies } = cloudContext;

  ipcMain.handle("cloud-transcribe", async (event, audioBuffer, opts = {}) => {
    try {
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("EchoDraft API URL not configured");

      const cookieHeader = await getSessionCookies(event);
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
            res.on("data", (chunk) => (responseData += chunk));
            res.on("end", () => {
              try {
                const parsed = JSON.parse(responseData);
                resolve({ statusCode: res.statusCode, data: parsed });
              } catch (e) {
                reject(new Error(`Invalid JSON response: ${responseData.slice(0, 200)}`));
              }
            });
          }
        );
        req.on("error", reject);
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
          ...data.data,
        };
      }
      if (data.statusCode !== 200) {
        throw new Error(data.data?.error || `API error: ${data.statusCode}`);
      }

      return {
        success: true,
        text: data.data.text,
        wordsUsed: data.data.wordsUsed,
        wordsRemaining: data.data.wordsRemaining,
        plan: data.data.plan,
        limitReached: data.data.limitReached || false,
      };
    } catch (error) {
      debugLogger.error("Cloud transcription error", { error: error.message }, "cloud-api");
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("cloud-reason", async (event, text, opts = {}) => {
    try {
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("EchoDraft API URL not configured");

      debugLogger.debug(
        "cloud-reason request",
        {
          model: opts.model || null,
          agentName: opts.agentName || null,
          language: opts.language || null,
          textLength: text?.length || 0,
        },
        "cloud-api"
      );

      const cookieHeader = await getSessionCookies(event);
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
          model: opts.model,
          agentName: opts.agentName,
          customDictionary: opts.customDictionary,
          language: opts.language,
          sessionId,
          clientType: "desktop",
          appVersion: app.getVersion(),
        }),
      });
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
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const data = await response.json();
      return { success: true, text: data.text, model: data.model, provider: data.provider };
    } catch (error) {
      debugLogger.error("Cloud reasoning error:", error);
      return { success: false, error: error.message };
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

