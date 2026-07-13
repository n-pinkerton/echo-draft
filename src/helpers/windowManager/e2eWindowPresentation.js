function isTruthyFlag(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function shouldSuppressWindowPresentation(env = process.env) {
  return isTruthyFlag(env.OPENWHISPR_E2E) && isTruthyFlag(env.OPENWHISPR_E2E_SUPPRESS_WINDOW_FOCUS);
}

module.exports = { shouldSuppressWindowPresentation };
