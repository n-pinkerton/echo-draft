const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isTruthyFlag(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function safeString(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

module.exports = {
  assert,
  isTruthyFlag,
  safeString,
  sleep,
};

