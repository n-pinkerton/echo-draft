const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROVIDER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

const hashDiagnosticValue = (candidate, prefix) => {
  let hash = 2166136261;
  for (let index = 0; index < candidate.length; index += 1) {
    hash ^= candidate.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

export const sanitizeOpaqueRequestId = (value) => {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!OPAQUE_ID_PATTERN.test(candidate)) return null;
  if (/^req-[a-f0-9]{8}$/.test(candidate)) return candidate;
  return hashDiagnosticValue(candidate, "req");
};

export const sanitizeProviderCode = (value) => {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!PROVIDER_CODE_PATTERN.test(candidate)) return null;
  if (/^code-[a-f0-9]{8}$/.test(candidate)) return candidate;
  return hashDiagnosticValue(candidate, "code");
};

export const sanitizeEndpointForLogging = (value) => {
  try {
    const parsed = new URL(String(value || ""));
    if (!/^(?:https?|wss?):$/.test(parsed.protocol)) return "[invalid endpoint]";
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "[invalid endpoint]";
  }
};

export const normalizeProviderEnum = (value, allowedValues) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : "other";
};

export const finiteNonNegativeNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
