const debugLogger = require("../../debugLogger");
const { buildCloudRequestUrl } = require("../cloud/cloudContext");
const { requireTrustedRenderer } = require("../trustedRenderer");
const { normalizeLanguageCode } = require("../../../utils/languagePolicy.cjs");

const CLOUD_CLEANUP_MODELS = new Set(["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol"]);
const SAFE_METADATA_TOKEN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const MAX_CLOUD_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_CLOUD_AUDIO_BYTES = 128 * 1024 * 1024;
const CLOUD_TRANSCRIPTION_TIMEOUT_MS = 5 * 60 * 1000;

const getPublicCloudOperationError = (operation) => {
  if (operation === "usage") return "Could not load usage information";
  if (operation === "checkout") return "Could not start checkout";
  if (operation === "billing") return "Could not open the billing portal";
  return "The cloud request could not be completed";
};

const getErrorCategory = (error) => {
  const code = typeof error?.code === "string" ? error.code : "";
  if (/^[A-Z0-9_]{1,64}$/.test(code)) return code;
  const name = typeof error?.name === "string" ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "Error";
};

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

const normalizeAudioBuffer = (value) => {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value))
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Buffer.isBuffer(value)) return value;
  throw new Error("Audio payload must be binary data");
};

const normalizeCloudTranscriptionOptions = (value = {}) => {
  const options = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const language = normalizeLanguageCode(options.language, {
    allowAuto: false,
  });
  return language ? { language } : {};
};

const normalizeCloudReasonOptions = (value = {}) => {
  const options = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const language = normalizeLanguageCode(options.language, { allowAuto: true });
  return {
    model: options.model,
    ...(language ? { language } : {}),
  };
};

const readResponseJsonBounded = async (response, maxBytes = MAX_CLOUD_RESPONSE_BYTES) => {
  const declared = Number(response?.headers?.get?.("content-length") || "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error("Cloud response exceeded the size limit");
  }

  let bytes;
  if (typeof response?.body?.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error("Cloud response exceeded the size limit");
        }
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks, totalBytes);
    } finally {
      reader.releaseLock?.();
    }
  } else {
    throw new Error("Cloud service returned an unreadable response");
  }

  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Cloud service returned invalid JSON");
  }
};

const rejectRedirectResponse = (response, operation) => {
  if (
    response?.redirected === true ||
    response?.type === "opaqueredirect" ||
    (response?.status >= 300 && response?.status < 400)
  ) {
    response?.body?.cancel?.().catch(() => {});
    throw new Error(`${operation} refused an HTTP redirect`);
  }
};

function registerCloudApiHandlers(
  { ipcMain, app, https, shell },
  { cloudContext, sessionId, whisperManager, cancelableRequests, windowManager }
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
    requireTrustedRenderer(event, windowManager);
    let requestScope;
    try {
      requestScope = cancelableRequests.createScope(event, requestId);
      const { signal } = requestScope;
      throwIfCancelled(signal);
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("EchoDraft API URL not configured");
      const requestUrl = buildCloudRequestUrl(apiUrl, "/api/transcribe");

      const cookieHeader = await getSessionCookies(event, requestUrl);
      throwIfCancelled(signal);
      if (!cookieHeader) throw new Error("No session cookies available");

      const audioData = normalizeAudioBuffer(audioBuffer);
      if (audioData.length < 1 || audioData.length > MAX_CLOUD_AUDIO_BYTES) {
        throw new Error("Audio payload is missing or too large");
      }
      const boundary = `----EchoDraft${Date.now()}`;
      const parts = [];

      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
          `Content-Type: audio/webm\r\n\r\n`
      );
      parts.push(audioData);
      parts.push("\r\n");

      const safeOptions = normalizeCloudTranscriptionOptions(opts);
      const language = safeOptions.language;
      if (language) {
        parts.push(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="language"\r\n\r\n` +
            `${language}\r\n`
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

      const url = new URL(requestUrl);

      const data = await new Promise((resolve, reject) => {
        let settled = false;
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          callback(value);
        };
        const req = https.request(
          {
            hostname: url.hostname,
            port: url.port || 443,
            path: `${url.pathname}${url.search}`,
            method: "POST",
            headers: {
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
              "Content-Length": body.length,
              Cookie: cookieHeader,
            },
          },
          (res) => {
            const statusCode = Number(res.statusCode || 0);
            if (statusCode >= 300 && statusCode < 400) {
              res.resume?.();
              settle(reject, new Error("Cloud transcription refused an HTTP redirect"));
              return;
            }

            const chunks = [];
            let responseBytes = 0;
            res.on("data", (chunk) => {
              if (settled) return;
              const bytes = Buffer.from(chunk);
              responseBytes += bytes.length;
              if (responseBytes > MAX_CLOUD_RESPONSE_BYTES) {
                req.destroy(new Error("Cloud transcription response exceeded the size limit"));
                return;
              }
              chunks.push(bytes);
            });
            res.on("error", (error) => settle(reject, error));
            res.on("end", () => {
              if (settled) return;
              if (signal.aborted) {
                settle(
                  reject,
                  Object.assign(new Error("Request cancelled"), { name: "AbortError" })
                );
                return;
              }
              const responseData = Buffer.concat(chunks, responseBytes).toString("utf8");
              try {
                const parsed = JSON.parse(responseData);
                settle(resolve, { statusCode, data: parsed });
              } catch {
                settle(reject, new Error("Cloud transcription returned invalid JSON"));
              }
            });
          }
        );
        const handleAbort = () => {
          req.destroy(Object.assign(new Error("Request cancelled"), { name: "AbortError" }));
        };
        signal.addEventListener("abort", handleAbort, { once: true });
        req.setTimeout?.(CLOUD_TRANSCRIPTION_TIMEOUT_MS, () => {
          req.destroy(new Error("Cloud transcription timed out"));
        });
        req.on("error", (error) => settle(reject, error));
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
    requireTrustedRenderer(event, windowManager);
    let requestScope;
    try {
      requestScope = cancelableRequests.createScope(event, requestId);
      const { signal } = requestScope;
      throwIfCancelled(signal);
      if (typeof text !== "string" || text.length < 1 || text.length > 1_000_000) {
        throw new Error("Reasoning input is missing or too large");
      }
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("EchoDraft API URL not configured");
      const requestUrl = buildCloudRequestUrl(apiUrl, "/api/reason");
      const safeOptions = normalizeCloudReasonOptions(opts);
      const requestedModel = normalizeCleanupModel(safeOptions.model);
      if (safeOptions.model && !requestedModel) {
        throw new Error("Unsupported EchoDraft cloud cleanup model");
      }

      debugLogger.debug(
        "cloud-reason request",
        {
          model: requestedModel,
          language: safeOptions.language,
          textLength: text?.length || 0,
        },
        "cloud-api"
      );

      const cookieHeader = await getSessionCookies(event, requestUrl);
      throwIfCancelled(signal);
      if (!cookieHeader) throw new Error("No session cookies available");

      const fetchStart = Date.now();
      const response = await fetch(requestUrl, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          text,
          model: requestedModel || undefined,
          language: safeOptions.language,
          sessionId,
          clientType: "desktop",
          appVersion: app.getVersion(),
        }),
        signal,
      });
      throwIfCancelled(signal);
      rejectRedirectResponse(response, "Cloud reasoning");
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

      const data = await readResponseJsonBounded(response);
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
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    try {
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("EchoDraft API URL not configured");
      const requestUrl = buildCloudRequestUrl(apiUrl, "/api/usage");

      const cookieHeader = await getSessionCookies(event, requestUrl);
      if (!cookieHeader) throw new Error("No session cookies available");

      const response = await fetch(requestUrl, {
        redirect: "manual",
        headers: { Cookie: cookieHeader },
      });
      rejectRedirectResponse(response, "Cloud usage");

      if (!response.ok) {
        if (response.status === 401) {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        throw new Error(`API error: ${response.status}`);
      }

      const data = await readResponseJsonBounded(response);
      return {
        success: true,
        wordsUsed: finiteNumber(data?.wordsUsed),
        wordsRemaining: finiteNumber(data?.wordsRemaining),
        limit: finiteNumber(data?.limit),
        plan: normalizeMetadataToken(data?.plan),
        isSubscribed: data?.isSubscribed === true,
        isTrial: data?.isTrial === true,
        trialDaysLeft: finiteNumber(data?.trialDaysLeft) ?? null,
        currentPeriodEnd:
          typeof data?.currentPeriodEnd === "string" ? data.currentPeriodEnd.slice(0, 64) : null,
        resetAt: typeof data?.resetAt === "string" ? data.resetAt.slice(0, 64) : undefined,
      };
    } catch (error) {
      debugLogger.error("Cloud usage fetch error", { errorCategory: getErrorCategory(error) });
      return { success: false, error: getPublicCloudOperationError("usage") };
    }
  });

  const fetchStripeUrl = async (event, endpoint, errorPrefix) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    try {
      const apiUrl = getApiUrl();
      if (!apiUrl) throw new Error("EchoDraft API URL not configured");
      const requestUrl = buildCloudRequestUrl(apiUrl, endpoint);

      const cookieHeader = await getSessionCookies(event, requestUrl);
      if (!cookieHeader) throw new Error("No session cookies available");

      const response = await fetch(requestUrl, {
        method: "POST",
        redirect: "manual",
        headers: { Cookie: cookieHeader },
      });
      rejectRedirectResponse(response, "Cloud billing request");

      if (!response.ok) {
        if (response.status === 401) {
          return { success: false, error: "Session expired", code: "AUTH_EXPIRED" };
        }
        await response.body?.cancel?.().catch(() => {});
        const error = new Error("Cloud billing request failed");
        error.code = "CLOUD_BILLING_HTTP_ERROR";
        throw error;
      }

      const data = await readResponseJsonBounded(response);
      const url = new URL(String(data?.url || ""));
      if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2048) {
        throw new Error("Cloud billing service returned an invalid URL");
      }
      return { success: true, url: url.toString() };
    } catch (error) {
      debugLogger.error(errorPrefix, { errorCategory: getErrorCategory(error) });
      return {
        success: false,
        error: getPublicCloudOperationError(endpoint.includes("checkout") ? "checkout" : "billing"),
      };
    }
  };

  ipcMain.handle("cloud-checkout", (event) =>
    fetchStripeUrl(event, "/api/stripe/checkout", "Cloud checkout error")
  );

  ipcMain.handle("cloud-billing-portal", (event) =>
    fetchStripeUrl(event, "/api/stripe/portal", "Cloud billing portal error")
  );

  ipcMain.handle("open-whisper-models-folder", async (event) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
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

module.exports = {
  CLOUD_TRANSCRIPTION_TIMEOUT_MS,
  MAX_CLOUD_RESPONSE_BYTES,
  getErrorCategory,
  getPublicCloudOperationError,
  normalizeCloudReasonOptions,
  normalizeCloudTranscriptionOptions,
  readResponseJsonBounded,
  rejectRedirectResponse,
  registerCloudApiHandlers,
};
