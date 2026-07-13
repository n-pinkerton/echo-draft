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
  "auth",
  "authorization",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "customreasoningkey",
  "customtranscriptionkey",
  "idtoken",
  "key",
  "keypreview",
  "password",
  "passphrase",
  "proxyauthorization",
  "reasoningkey",
  "refreshtoken",
  "secret",
  "signature",
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
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/\b(?:Set-Cookie|Cookie)\s*:\s*[^\r\n]+/gi, (header) => {
      const name = header.slice(0, header.indexOf(":"));
      return `${name}: ${REDACTED}`;
    })
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, (rawUrl) => {
      try {
        const parsed = new URL(rawUrl);
        parsed.username = "";
        parsed.password = "";
        parsed.search = "";
        parsed.hash = "";
        return parsed.toString();
      } catch {
        return REDACTED;
      }
    })
    .replace(/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\bgsk_[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, REDACTED)
    .replace(
      /([?&](?:api[_-]?key|key|signature|auth|access[_-]?token|refresh[_-]?token|token|client[_-]?secret)=)[^&#\s]+/gi,
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
