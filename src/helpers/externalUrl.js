const MAX_EXTERNAL_URL_CHARS = 2048;

const normalizeExternalHttpsUrl = (value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > MAX_EXTERNAL_URL_CHARS || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error("Invalid external link");
  }
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Only HTTPS links without embedded credentials can be opened");
  }
  return parsed.toString();
};

module.exports = { MAX_EXTERNAL_URL_CHARS, normalizeExternalHttpsUrl };
