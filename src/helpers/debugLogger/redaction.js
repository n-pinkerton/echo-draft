const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;

const normalizeKey = (key) =>
  String(key || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const PRESENCE_FLAG_PATTERN = /^(has|is).*(apikey|credential|password|secret|token)$/;
const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "customreasoningkey",
  "customtranscriptionkey",
  "idtoken",
  "keypreview",
  "password",
  "passphrase",
  "proxyauthorization",
  "reasoningkey",
  "refreshtoken",
  "secret",
  "sessiontoken",
  "secretpreview",
  "setcookie",
  "transcriptionkey",
  "tokenpreview",
  "xapikey",
]);

const isSensitiveKey = (key) => {
  const normalized = normalizeKey(key);
  if (!normalized || PRESENCE_FLAG_PATTERN.test(normalized)) {
    return false;
  }
  return SENSITIVE_KEYS.has(normalized) || normalized.endsWith("apikey");
};

const redactSensitiveString = (value) => {
  if (!value) return value;

  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\bgsk_[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, REDACTED)
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token)=)[^&#\s]+/gi,
      `$1${REDACTED}`
    )
    .replace(
      /\b((?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|PASSWORD|CLIENT_SECRET))\s*=\s*[^\s,;]+/g,
      `$1=${REDACTED}`
    );
};

const redactSensitiveData = (value, options = {}) => {
  const seen = options.seen || new WeakSet();
  const depth = options.depth || 0;

  if (typeof value === "string") {
    return redactSensitiveString(value);
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (depth >= MAX_DEPTH) {
    return "[Max depth]";
  }
  if (seen.has(value)) {
    return "[Circular]";
  }

  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitiveString(value.message),
      stack: redactSensitiveString(value.stack || ""),
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveData(entry, { seen, depth: depth + 1 }));
  }

  const redacted = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = isSensitiveKey(key)
      ? REDACTED
      : redactSensitiveData(entry, { seen, depth: depth + 1 });
  }
  return redacted;
};

module.exports = {
  REDACTED,
  isSensitiveKey,
  redactSensitiveData,
  redactSensitiveString,
};
