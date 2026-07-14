const { requireTrustedRenderer } = require("../trustedRenderer");
const modelRegistryData = require("../../../models/modelRegistryData.json");
const {
  BUILT_IN_CLEANUP_DICTIONARY,
  CLEANUP_PROMPT_MODES,
  buildCleanupSystemPrompt,
  validateWrappedCleanupInput,
} = require("../../../config/cleanupPolicy.cjs");
const {
  MAX_USER_DICTIONARY_ENTRIES,
  sanitizeLexicalDictionaryEntries,
} = require("../../../utils/dictionaryLexicon.cjs");
const { requireLanguageCode } = require("../../../utils/languagePolicy.cjs");

const MAX_JSON_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_REQUEST_BYTES = 64 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PROVIDER_REQUESTS_PER_SENDER = 4;
const MAX_PROVIDER_IN_FLIGHT_BYTES_PER_SENDER = 96 * 1024 * 1024;
const CLEANUP_REQUEST_TIMEOUT_MS = 200_000;
const MODEL_DISCOVERY_TIMEOUT_MS = 30_000;
const TRANSCRIPTION_REQUEST_TIMEOUT_MS = 330_000;
const TRANSCRIPTION_PROGRESS_CHANNEL = "provider-transcription-progress";
const TRANSCRIPTION_PROGRESS_MIN_INTERVAL_MS = 100;
const MAX_TRANSCRIPTION_DICTIONARY_ENTRIES =
  BUILT_IN_CLEANUP_DICTIONARY.length + MAX_USER_DICTIONARY_ENTRIES;
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
]);

const PROVIDER_BASES = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  mistral: "https://api.mistral.ai/v1",
};

const PROVIDERS_BY_PURPOSE = {
  reasoning: new Set(["openai", "groq", "gemini", "custom"]),
  transcription: new Set(["openai", "groq", "mistral", "custom"]),
};

const REASONING_MODELS_BY_PROVIDER = new Map(
  (modelRegistryData.cloudProviders || []).map((provider) => [
    provider.id,
    new Set((provider.models || []).map((model) => model.id)),
  ])
);
const TRANSCRIPTION_MODELS_BY_PROVIDER = new Map(
  (modelRegistryData.transcriptionProviders || []).map((provider) => [
    provider.id,
    new Set((provider.models || []).map((model) => model.id)),
  ])
);

const assertExactKeys = (value, allowed, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new Error(`${label} contains unsupported fields`);
};

const validateModelToken = (model, label = "model") => {
  const value = typeof model === "string" ? model.trim() : "";
  if (!value || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
};

const validateFirstPartyModel = (provider, model, purpose) => {
  const value = validateModelToken(model, `${purpose} model`);
  if (provider === "custom") return value;
  const models =
    purpose === "cleanup"
      ? REASONING_MODELS_BY_PROVIDER.get(provider)
      : TRANSCRIPTION_MODELS_BY_PROVIDER.get(provider);
  if (!models?.has(value)) throw new Error(`Unsupported ${purpose} model`);
  return value;
};

const validateCleanupOperation = (provider, endpoint, operation) => {
  const allowedKeys = new Set([
    "kind",
    "variant",
    "model",
    "userPrompt",
    "cleanupPromptMode",
    "language",
    "dictionaryEntries",
    "maxOutputTokens",
    "temperature",
    "reasoningEffort",
  ]);
  assertExactKeys(operation, allowedKeys, "Cleanup operation");
  if (operation.kind !== "cleanup") throw new Error("Only cleanup operations are supported");
  const variant = operation.variant;
  if (!new Set(["responses", "chat-completions", "gemini-generate"]).has(variant)) {
    throw new Error("Unsupported cleanup operation variant");
  }
  const model = validateFirstPartyModel(provider, operation.model, "cleanup");
  const cleanupPromptMode = operation.cleanupPromptMode || "standard";
  if (!CLEANUP_PROMPT_MODES.has(cleanupPromptMode)) {
    throw new Error("Cleanup prompt mode is unsupported");
  }
  const language = requireLanguageCode(operation.language, { allowAuto: true }, "cleanup language");
  const { userPrompt } = validateWrappedCleanupInput(operation.userPrompt, model);
  let dictionaryEntries = [];
  if (operation.dictionaryEntries !== undefined) {
    if (!Array.isArray(operation.dictionaryEntries) || operation.dictionaryEntries.length > 100) {
      throw new Error("Cleanup dictionary is unsupported");
    }
    dictionaryEntries = sanitizeLexicalDictionaryEntries(operation.dictionaryEntries, {
      maxEntries: 100,
      maxEntryLength: 80,
      maxWords: 1,
    });
    if (dictionaryEntries.length !== operation.dictionaryEntries.length) {
      throw new Error("Cleanup dictionary must contain unique single lexical terms only");
    }
  }
  const maxOutputTokens = Number(operation.maxOutputTokens);
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 64 || maxOutputTokens > 32_768) {
    throw new Error("Cleanup output budget is unsupported");
  }
  let temperature;
  if (operation.temperature !== undefined) {
    temperature = Number(operation.temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1.5) {
      throw new Error("Cleanup temperature is unsupported");
    }
  }
  let reasoningEffort;
  if (operation.reasoningEffort !== undefined) {
    reasoningEffort = String(operation.reasoningEffort);
    if (!new Set(["none", "low", "medium", "high"]).has(reasoningEffort)) {
      throw new Error("Cleanup reasoning effort is unsupported");
    }
  }

  const pathname = new URL(endpoint).pathname.replace(/\/+$/, "");
  const expectedVariant = pathname.endsWith("/responses")
    ? "responses"
    : pathname.endsWith("/chat/completions")
      ? "chat-completions"
      : pathname.endsWith(":generateContent")
        ? "gemini-generate"
        : null;
  if (variant !== expectedVariant) throw new Error("Cleanup operation does not match its endpoint");
  if (provider === "gemini") {
    const endpointModel = pathname.match(/\/models\/([^/]+):generateContent$/)?.[1];
    if (variant !== "gemini-generate" || endpointModel !== model) {
      throw new Error("Gemini cleanup model does not match its endpoint");
    }
  } else if (variant === "gemini-generate") {
    throw new Error("Gemini cleanup operations require the Gemini provider");
  }

  return {
    kind: "cleanup",
    variant,
    model,
    userPrompt,
    cleanupPromptMode,
    ...(language ? { language } : {}),
    ...(dictionaryEntries.length > 0 ? { dictionaryEntries } : {}),
    maxOutputTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  };
};

const buildProviderCleanupBody = (provider, operation) => {
  const systemPrompt = buildCleanupSystemPrompt(
    operation.model,
    operation.cleanupPromptMode,
    operation.language,
    operation.dictionaryEntries
  );
  if (operation.variant === "responses") {
    return {
      model: operation.model,
      input: [
        { role: "developer", content: systemPrompt },
        { role: "user", content: operation.userPrompt },
      ],
      store: false,
      max_output_tokens: operation.maxOutputTokens,
      ...(operation.reasoningEffort ? { reasoning: { effort: operation.reasoningEffort } } : {}),
      ...(operation.reasoningEffort ? { text: { verbosity: "medium" } } : {}),
      ...(operation.reasoningEffort ? { truncation: "disabled" } : {}),
    };
  }
  if (operation.variant === "gemini-generate") {
    return {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: operation.userPrompt }] }],
      generationConfig: {
        ...(operation.temperature !== undefined ? { temperature: operation.temperature } : {}),
        maxOutputTokens: operation.maxOutputTokens,
      },
    };
  }
  const usesMaxCompletionTokens = operation.model.startsWith("gpt-5");
  return {
    model: operation.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: operation.userPrompt },
    ],
    ...(provider === "openai" ? { store: false } : {}),
    ...(operation.temperature !== undefined ? { temperature: operation.temperature } : {}),
    ...(usesMaxCompletionTokens
      ? { max_completion_tokens: operation.maxOutputTokens }
      : { max_tokens: operation.maxOutputTokens }),
    ...(operation.reasoningEffort ? { reasoning_effort: operation.reasoningEffort } : {}),
  };
};

const byteLength = (value) => Buffer.byteLength(String(value || ""), "utf8");

const getCustomBase = (environmentManager, purpose) =>
  purpose === "transcription"
    ? environmentManager.getCustomTranscriptionBaseUrl?.()
    : environmentManager.getCustomReasoningBaseUrl?.();

const getProviderKey = (environmentManager, provider, purpose) => {
  switch (provider) {
    case "openai":
      return environmentManager.getOpenAIKey();
    case "groq":
      return environmentManager.getGroqKey();
    case "gemini":
      return environmentManager.getGeminiKey();
    case "mistral":
      return environmentManager.getMistralKey();
    case "custom":
      return purpose === "transcription"
        ? environmentManager.getCustomTranscriptionKey()
        : environmentManager.getCustomReasoningKey();
    default:
      return "";
  }
};

const isWithinBaseUrl = (candidate, base) => {
  let target;
  let allowed;
  try {
    target = new URL(candidate);
    allowed = new URL(base);
  } catch {
    return false;
  }
  if (target.username || target.password || target.hash) return false;
  if (target.origin !== allowed.origin) return false;
  const basePath = allowed.pathname.replace(/\/+$/, "");
  return target.pathname === basePath || target.pathname.startsWith(`${basePath}/`);
};

const validateProviderEndpoint = (environmentManager, provider, purpose, endpoint) => {
  if (!PROVIDERS_BY_PURPOSE[purpose]?.has(provider)) {
    throw new Error("Unsupported provider request");
  }
  const base =
    provider === "custom" ? getCustomBase(environmentManager, purpose) : PROVIDER_BASES[provider];
  if (!base || !isWithinBaseUrl(endpoint, base)) {
    throw new Error("Provider endpoint does not match the configured provider");
  }
  const parsed = new URL(endpoint);
  const localCustom =
    provider === "custom" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(localCustom && parsed.protocol === "http:")) {
    throw new Error("Provider endpoints must use HTTPS (except localhost custom endpoints)");
  }

  if (provider !== "custom") {
    const normalizedPath = parsed.pathname.replace(/\/+$/, "");
    const allowed =
      purpose === "transcription"
        ? normalizedPath === `${new URL(base).pathname.replace(/\/+$/, "")}/audio/transcriptions`
        : (provider === "openai" &&
            ["/v1/responses", "/v1/chat/completions"].includes(normalizedPath)) ||
          (provider === "groq" && normalizedPath === "/openai/v1/chat/completions") ||
          (provider === "gemini" &&
            /^\/v1beta\/models\/[A-Za-z0-9._-]{1,200}:generateContent$/.test(normalizedPath));
    if (!allowed) {
      throw new Error("Provider endpoint is not approved for this operation");
    }
  }
  return parsed.toString();
};

const validateCustomModelsEndpoint = (environmentManager, purpose, endpoint) => {
  const validated = validateProviderEndpoint(environmentManager, "custom", purpose, endpoint);
  const base = String(getCustomBase(environmentManager, purpose) || "").replace(/\/+$/, "");
  const expected = new URL(`${base}/models`);
  const parsed = new URL(validated);
  if (
    parsed.origin !== expected.origin ||
    parsed.pathname.replace(/\/+$/, "") !== expected.pathname.replace(/\/+$/, "") ||
    parsed.search
  ) {
    throw new Error("Custom model discovery is restricted to the approved /models endpoint");
  }
  return parsed.toString();
};

const buildProviderHeaders = (provider, key, contentType) => {
  const headers = { "Content-Type": contentType };
  if (!key) return headers;
  if (provider === "gemini") headers["x-goog-api-key"] = key;
  else headers.Authorization = `Bearer ${key}`;
  return headers;
};

const responseHeaders = (response) => {
  const allowed = ["content-type", "retry-after", "x-request-id", "openai-request-id"];
  const result = {};
  for (const name of allowed) {
    const value = response.headers.get(name);
    if (value) result[name] = value.slice(0, 512);
  }
  return result;
};

const toAbortReason = (signal) => {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("Request cancelled");
  error.name = "AbortError";
  error.code = "REQUEST_CANCELLED";
  return error;
};

const awaitWithSignal = (promise, signal) => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(toAbortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(toAbortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
};

const createHardDeadline = (parentSignal, timeoutMs) => {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(toAbortReason(parentSignal));
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    const error = new Error("Provider request reached its hard time limit");
    error.name = "AbortError";
    error.code = "PROVIDER_TIMEOUT";
    controller.abort(error);
  }, timeoutMs);
  return {
    signal: controller.signal,
    finish() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
};

const createSenderBudget = () => {
  const states = new Map();
  const reserve = (event, bytes = 0) => {
    const senderId = event?.sender?.id;
    if (!Number.isInteger(senderId) || senderId < 0) throw new Error("Provider sender unavailable");
    let state = states.get(senderId);
    if (!state) {
      const sender = event.sender;
      const onDestroyed = () => states.delete(senderId);
      state = { sender, count: 0, bytes: 0, onDestroyed };
      states.set(senderId, state);
      sender.once?.("destroyed", onDestroyed);
    }
    if (
      state.count >= MAX_PROVIDER_REQUESTS_PER_SENDER ||
      state.bytes + bytes > MAX_PROVIDER_IN_FLIGHT_BYTES_PER_SENDER
    ) {
      throw new Error("Provider request capacity is temporarily exhausted");
    }
    state.count += 1;
    state.bytes += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = states.get(senderId);
      if (current !== state) return;
      state.count = Math.max(0, state.count - 1);
      state.bytes = Math.max(0, state.bytes - bytes);
      if (state.count === 0) {
        state.sender.removeListener?.("destroyed", state.onDestroyed);
        states.delete(senderId);
      }
    };
  };
  return { reserve, states };
};

const cancelReadableBestEffort = (readable) => {
  try {
    Promise.resolve(readable?.cancel?.()).catch(() => {});
  } catch {
    // Cancellation is advisory; request settlement must not depend on provider stream behavior.
  }
};

const readResponseTextBounded = async (
  response,
  maxBytes = MAX_PROVIDER_RESPONSE_BYTES,
  onChunk = null,
  signal = null
) => {
  const declared = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    cancelReadableBestEffort(response.body);
    throw new Error("Provider response exceeded the size limit");
  }
  if (!response.body?.getReader) {
    const text = await awaitWithSignal(response.text(), signal);
    if (byteLength(text) > maxBytes) throw new Error("Provider response exceeded the size limit");
    if (typeof onChunk === "function" && text) onChunk(Buffer.from(text, "utf8"));
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await awaitWithSignal(reader.read(), signal).catch((error) => {
      cancelReadableBestEffort(reader);
      throw error;
    });
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      cancelReadableBestEffort(reader);
      throw new Error("Provider response exceeded the size limit");
    }
    if (typeof onChunk === "function") onChunk(value);
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString("utf8");
};

const countProgressWords = (value) =>
  String(value || "")
    .trim()
    .match(/\S+/gu)?.length || 0;

const createTranscriptionProgressTracker = (
  emit,
  { now = () => Date.now(), minIntervalMs = TRANSCRIPTION_PROGRESS_MIN_INTERVAL_MS } = {}
) => {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let collectedText = "";
  let finalText = "";
  let lastEmitAt = Number.NEGATIVE_INFINITY;
  let lastGeneratedChars = -1;
  let completionSent = false;

  const publish = (force = false, isComplete = false) => {
    const progressText = finalText.length >= collectedText.length ? finalText : collectedText;
    const generatedChars = progressText.length;
    if (!force && generatedChars === lastGeneratedChars) return;
    const timestamp = now();
    if (!force && timestamp - lastEmitAt < minIntervalMs) return;
    lastEmitAt = timestamp;
    lastGeneratedChars = generatedChars;
    completionSent = completionSent || isComplete;
    try {
      emit?.({
        generatedChars,
        generatedWords: countProgressWords(progressText),
        isComplete: completionSent,
      });
    } catch {
      // UI progress is best-effort and must never fail the provider request.
    }
  };

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") {
      publish(true, true);
      return;
    }
    try {
      const payload = JSON.parse(data);
      if (payload?.type === "transcript.text.delta" && typeof payload.delta === "string") {
        collectedText += payload.delta;
        publish();
      } else if (payload?.type === "transcript.text.segment" && typeof payload.text === "string") {
        collectedText += payload.text;
        publish();
      } else if (payload?.type === "transcript.text.done" && typeof payload.text === "string") {
        finalText = payload.text;
        publish(true, true);
      }
    } catch {
      // Ignore malformed provider events. The renderer's final parser remains authoritative.
    }
  };

  const processBuffer = (flush = false) => {
    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop() ?? "";
    buffer = flush ? "" : remainder;
    for (const line of lines) handleLine(line);
    if (flush && remainder.trim()) handleLine(remainder);
  };

  return {
    push(value) {
      buffer += decoder.decode(value, { stream: true });
      processBuffer(false);
    },
    finish() {
      buffer += decoder.decode();
      processBuffer(true);
      if (!completionSent && (collectedText || finalText)) publish(true, false);
    },
  };
};

const normalizeAudioBuffer = (value) => {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value))
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Buffer.isBuffer(value)) return value;
  throw new Error("Audio payload must be binary data");
};

const validateAudioLength = (length) => {
  if (!Number.isSafeInteger(length) || length < 1 || length > MAX_AUDIO_REQUEST_BYTES) {
    throw new Error("Audio payload is missing or too large");
  }
  return length;
};

function registerProviderRequestHandlers(
  { ipcMain },
  { environmentManager, cancelableRequests, windowManager, fetchImpl = globalThis.fetch }
) {
  const senderBudget = createSenderBudget();
  ipcMain.handle("get-api-key-status", (event) => {
    requireTrustedRenderer(event, windowManager);
    return {
      openai: Boolean(environmentManager.getOpenAIKey()),
      anthropic: Boolean(environmentManager.getAnthropicKey()),
      gemini: Boolean(environmentManager.getGeminiKey()),
      groq: Boolean(environmentManager.getGroqKey()),
      mistral: Boolean(environmentManager.getMistralKey()),
      customTranscription: Boolean(environmentManager.getCustomTranscriptionKey()),
      customReasoning: Boolean(environmentManager.getCustomReasoningKey()),
    };
  });

  ipcMain.handle("provider-cleanup-request", async (event, payload = {}, requestId) => {
    requireTrustedRenderer(event, windowManager);
    const requestScope = cancelableRequests.createScope(event, requestId);
    const deadline = createHardDeadline(requestScope.signal, CLEANUP_REQUEST_TIMEOUT_MS);
    let releaseBudget = () => {};
    try {
      assertExactKeys(payload, new Set(["provider", "endpoint", "operation"]), "Provider request");
      const provider = String(payload.provider || "").toLowerCase();
      const endpoint = validateProviderEndpoint(
        environmentManager,
        provider,
        "reasoning",
        payload.endpoint
      );
      const operation = validateCleanupOperation(provider, endpoint, payload.operation);
      const body = JSON.stringify(buildProviderCleanupBody(provider, operation));
      const bodyBytes = byteLength(body);
      if (bodyBytes < 1 || bodyBytes > MAX_JSON_REQUEST_BYTES) {
        throw new Error("Provider cleanup request is too large");
      }
      releaseBudget = senderBudget.reserve(event, bodyBytes);
      const key = getProviderKey(environmentManager, provider, "reasoning");
      if (!key && provider !== "custom") throw new Error("Provider API key is not configured");

      const response = await awaitWithSignal(
        fetchImpl(endpoint, {
          method: "POST",
          headers: buildProviderHeaders(provider, key, "application/json"),
          body,
          signal: deadline.signal,
          redirect: "manual",
        }),
        deadline.signal
      );
      if (response.status >= 300 && response.status < 400) {
        cancelReadableBestEffort(response.body);
        throw new Error("Provider redirects are not allowed");
      }
      return {
        status: response.status,
        headers: responseHeaders(response),
        body: await readResponseTextBounded(
          response,
          MAX_PROVIDER_RESPONSE_BYTES,
          null,
          deadline.signal
        ),
      };
    } finally {
      releaseBudget();
      deadline.finish();
      requestScope.finish();
    }
  });

  ipcMain.handle("provider-models-request", async (event, payload = {}, requestId) => {
    requireTrustedRenderer(event, windowManager, ["control-panel"]);
    const requestScope = cancelableRequests.createScope(event, requestId);
    const deadline = createHardDeadline(requestScope.signal, MODEL_DISCOVERY_TIMEOUT_MS);
    let releaseBudget = () => {};
    try {
      assertExactKeys(payload, new Set(["purpose", "endpoint"]), "Model discovery request");
      const purpose = payload.purpose === "transcription" ? "transcription" : "reasoning";
      const endpoint = validateCustomModelsEndpoint(environmentManager, purpose, payload.endpoint);
      releaseBudget = senderBudget.reserve(event, 0);
      const key = getProviderKey(environmentManager, "custom", purpose);
      const headers = key ? { Authorization: `Bearer ${key}` } : {};
      const response = await awaitWithSignal(
        fetchImpl(endpoint, {
          method: "GET",
          headers,
          signal: deadline.signal,
          redirect: "manual",
        }),
        deadline.signal
      );
      if (response.status >= 300 && response.status < 400) {
        cancelReadableBestEffort(response.body);
        throw new Error("Provider redirects are not allowed");
      }
      return {
        status: response.status,
        headers: responseHeaders(response),
        body: await readResponseTextBounded(
          response,
          MAX_PROVIDER_RESPONSE_BYTES,
          null,
          deadline.signal
        ),
      };
    } finally {
      releaseBudget();
      deadline.finish();
      requestScope.finish();
    }
  });

  ipcMain.handle("provider-transcription-request", async (event, payload = {}, requestId) => {
    requireTrustedRenderer(event, windowManager);
    const requestScope = cancelableRequests.createScope(event, requestId);
    const deadline = createHardDeadline(requestScope.signal, TRANSCRIPTION_REQUEST_TIMEOUT_MS);
    let releaseBudget = () => {};
    try {
      assertExactKeys(
        payload,
        new Set([
          "provider",
          "endpoint",
          "audioBuffer",
          "mimeType",
          "model",
          "language",
          "stream",
          "contextBias",
          "dictionaryEntries",
        ]),
        "Transcription request"
      );
      const provider = String(payload.provider || "").toLowerCase();
      const endpoint = validateProviderEndpoint(
        environmentManager,
        provider,
        "transcription",
        payload.endpoint
      );
      const audio = normalizeAudioBuffer(payload.audioBuffer);
      validateAudioLength(audio.length);
      releaseBudget = senderBudget.reserve(event, audio.length);
      const mimeType = String(payload.mimeType || "audio/webm")
        .split(";")[0]
        .toLowerCase();
      if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) throw new Error("Unsupported audio MIME type");
      const model = validateFirstPartyModel(provider, payload.model, "transcription");
      const language =
        requireLanguageCode(
          payload.language,
          { allowAuto: false, baseOnly: true },
          "transcription language"
        ) || "";
      if (payload.stream !== undefined && typeof payload.stream !== "boolean") {
        throw new Error("Invalid transcription streaming option");
      }
      let contextBias = [];
      if (payload.contextBias !== undefined) {
        if (provider !== "mistral") {
          throw new Error("Transcription context bias is supported only for Mistral");
        }
        if (!Array.isArray(payload.contextBias) || payload.contextBias.length > 100) {
          throw new Error("Invalid transcription context bias");
        }
        contextBias = sanitizeLexicalDictionaryEntries(payload.contextBias, {
          maxEntries: 100,
          maxEntryLength: 80,
          maxWords: 1,
        });
        if (contextBias.length !== payload.contextBias.length) {
          throw new Error("Transcription context bias must contain lexical terms only");
        }
      }
      let dictionaryEntries = [];
      if (payload.dictionaryEntries !== undefined) {
        if (
          provider !== "openai" ||
          !(model === "gpt-4o-transcribe" || model.startsWith("gpt-4o-mini-transcribe"))
        ) {
          throw new Error("Transcription dictionary context is unsupported for this model");
        }
        if (
          !Array.isArray(payload.dictionaryEntries) ||
          payload.dictionaryEntries.length > MAX_TRANSCRIPTION_DICTIONARY_ENTRIES
        ) {
          throw new Error("Invalid transcription dictionary context");
        }
        dictionaryEntries = sanitizeLexicalDictionaryEntries(payload.dictionaryEntries, {
          maxEntries: MAX_TRANSCRIPTION_DICTIONARY_ENTRIES,
          maxEntryLength: 80,
          maxWords: 1,
        });
        if (dictionaryEntries.length !== payload.dictionaryEntries.length) {
          throw new Error("Transcription dictionary context must contain lexical terms only");
        }
      }
      const key = getProviderKey(environmentManager, provider, "transcription");
      if (!key && provider !== "custom") throw new Error("Provider API key is not configured");

      const extension =
        mimeType === "audio/wav" || mimeType === "audio/x-wav"
          ? "wav"
          : mimeType === "audio/ogg"
            ? "ogg"
            : mimeType === "audio/mpeg"
              ? "mp3"
              : mimeType === "audio/mp4"
                ? "mp4"
                : "webm";
      const formData = new FormData();
      formData.append("file", new Blob([audio], { type: mimeType }), `audio.${extension}`);
      formData.append("model", model);
      if (language) formData.append("language", language);
      if (payload.stream === true) formData.append("stream", "true");
      if (dictionaryEntries.length > 0) {
        formData.append(
          "prompt",
          `The audio may include these names and technical terms. Use these exact spellings only when spoken: ${dictionaryEntries.join(", ")}.`
        );
      }
      if (provider === "mistral") {
        for (const token of contextBias) {
          formData.append("context_bias", token);
        }
      }

      const requestHeaders = buildProviderHeaders(provider, key, "application/octet-stream");
      delete requestHeaders["Content-Type"];
      const requestStartedAt = performance.now();
      const response = await awaitWithSignal(
        fetchImpl(endpoint, {
          method: "POST",
          headers: requestHeaders,
          body: formData,
          signal: deadline.signal,
          redirect: "manual",
        }),
        deadline.signal
      );
      if (response.status >= 300 && response.status < 400) {
        cancelReadableBestEffort(response.body);
        throw new Error("Provider redirects are not allowed");
      }
      const timeToHeadersMs = Math.max(0, Math.round(performance.now() - requestStartedAt));
      const sanitizedHeaders = responseHeaders(response);
      const shouldReportStreamingProgress =
        payload.stream === true &&
        response.status >= 200 &&
        response.status < 300 &&
        String(sanitizedHeaders["content-type"] || "")
          .toLowerCase()
          .includes("text/event-stream");
      const sendProgress = (progress) => {
        if (!shouldReportStreamingProgress || event.sender?.isDestroyed?.()) return;
        event.sender?.send?.(TRANSCRIPTION_PROGRESS_CHANNEL, {
          requestId: requestScope.requestId,
          generatedChars: progress.generatedChars,
          generatedWords: progress.generatedWords,
          isComplete: progress.isComplete === true,
        });
      };
      const progressTracker = shouldReportStreamingProgress
        ? createTranscriptionProgressTracker(sendProgress)
        : null;
      const bodyReadStartedAt = performance.now();
      const body = await readResponseTextBounded(
        response,
        MAX_PROVIDER_RESPONSE_BYTES,
        progressTracker ? (chunk) => progressTracker.push(chunk) : null,
        deadline.signal
      );
      progressTracker?.finish();
      const bodyReadDurationMs = Math.max(0, Math.round(performance.now() - bodyReadStartedAt));
      return {
        status: response.status,
        headers: sanitizedHeaders,
        body,
        timings: { timeToHeadersMs, bodyReadDurationMs },
      };
    } finally {
      releaseBudget();
      deadline.finish();
      requestScope.finish();
    }
  });
}

module.exports = {
  MAX_AUDIO_REQUEST_BYTES,
  MAX_JSON_REQUEST_BYTES,
  MAX_PROVIDER_IN_FLIGHT_BYTES_PER_SENDER,
  MAX_PROVIDER_REQUESTS_PER_SENDER,
  MAX_PROVIDER_RESPONSE_BYTES,
  TRANSCRIPTION_PROGRESS_CHANNEL,
  awaitWithSignal,
  buildProviderCleanupBody,
  cancelReadableBestEffort,
  createHardDeadline,
  createSenderBudget,
  createTranscriptionProgressTracker,
  isWithinBaseUrl,
  readResponseTextBounded,
  registerProviderRequestHandlers,
  validateAudioLength,
  validateCustomModelsEndpoint,
  validateCleanupOperation,
  validateProviderEndpoint,
};
