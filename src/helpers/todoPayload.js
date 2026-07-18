const crypto = require("crypto");

const MAX_TODO_TEXT_LENGTH = 20_000;
const MAX_TODO_META_BYTES = 256_000;
const MAX_TODO_PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalizeJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJsonValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeJsonValue(value[key])])
    );
  }
  return value;
}

function normalizeTodoPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid To Do payload");
  }

  const externalId = typeof payload.externalId === "string" ? payload.externalId.trim() : "";
  if (!UUID_PATTERN.test(externalId)) {
    throw new Error("Invalid To Do external ID");
  }

  const text = typeof payload.text === "string" ? payload.text : "";
  if (!text.trim() || text.length > MAX_TODO_TEXT_LENGTH) {
    throw new Error("Invalid To Do text");
  }

  const rawText =
    typeof payload.rawText === "string" && payload.rawText.trim() ? payload.rawText : null;
  if (rawText && rawText.length > MAX_TODO_TEXT_LENGTH) {
    throw new Error("Raw To Do text is too large");
  }

  if (
    payload.meta !== undefined &&
    (!payload.meta || typeof payload.meta !== "object" || Array.isArray(payload.meta))
  ) {
    throw new Error("Invalid To Do metadata");
  }

  const metaJson = payload.meta ? JSON.stringify(payload.meta) : "{}";
  if (Buffer.byteLength(metaJson, "utf8") > MAX_TODO_META_BYTES) {
    throw new Error("To Do metadata is too large");
  }

  const payloadHash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        text,
        rawText,
        meta: canonicalizeJsonValue(JSON.parse(metaJson)),
      })
    )
    .digest("hex");

  return { externalId: externalId.toLowerCase(), text, rawText, metaJson, payloadHash };
}

module.exports = {
  MAX_TODO_META_BYTES,
  MAX_TODO_PAGE_SIZE,
  MAX_TODO_TEXT_LENGTH,
  UUID_PATTERN,
  canonicalizeJsonValue,
  normalizeTodoPayload,
};
