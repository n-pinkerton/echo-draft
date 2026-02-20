const VALID_CHANNELS = new Set(["development", "staging", "production"]);

const DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL = {
  development: "openwhispr-dev",
  staging: "openwhispr-staging",
  production: "openwhispr",
};

const DEFAULT_AUTH_BRIDGE_PORT = 5199;

function isElectronBinaryExec(execPath = process.execPath) {
  const normalized = (execPath || "").toLowerCase();
  return (
    normalized.includes("/electron.app/contents/macos/electron") ||
    normalized.endsWith("/electron") ||
    normalized.endsWith("\\electron.exe")
  );
}

function inferDefaultChannel({
  nodeEnv = process.env.NODE_ENV,
  defaultApp = process.defaultApp,
  execPath = process.execPath,
} = {}) {
  if (nodeEnv === "development" || defaultApp || isElectronBinaryExec(execPath)) {
    return "development";
  }
  return "production";
}

function resolveAppChannel({
  env = process.env,
  nodeEnv = process.env.NODE_ENV,
  defaultApp = process.defaultApp,
  execPath = process.execPath,
} = {}) {
  const rawChannel = (env.OPENWHISPR_CHANNEL || env.VITE_OPENWHISPR_CHANNEL || "")
    .trim()
    .toLowerCase();

  if (VALID_CHANNELS.has(rawChannel)) {
    return rawChannel;
  }

  return inferDefaultChannel({ nodeEnv, defaultApp, execPath });
}

function getOAuthProtocol({
  env = process.env,
  channel = env.OPENWHISPR_CHANNEL || env.VITE_OPENWHISPR_CHANNEL || "production",
  defaults = DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL,
} = {}) {
  const fromEnv = (env.VITE_OPENWHISPR_PROTOCOL || env.OPENWHISPR_PROTOCOL || "")
    .trim()
    .toLowerCase();

  if (/^[a-z][a-z0-9+.-]*$/.test(fromEnv)) {
    return fromEnv;
  }

  return defaults[channel] || defaults.production;
}

function shouldRegisterProtocolWithAppArg({
  defaultApp = process.defaultApp,
  execPath = process.execPath,
} = {}) {
  return Boolean(defaultApp) || isElectronBinaryExec(execPath);
}

function parseAuthBridgePort({
  env = process.env,
  defaultPort = DEFAULT_AUTH_BRIDGE_PORT,
} = {}) {
  const raw = (env.OPENWHISPR_AUTH_BRIDGE_PORT || "").trim();
  if (!raw) return defaultPort;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return defaultPort;
  }

  return parsed;
}

module.exports = {
  DEFAULT_AUTH_BRIDGE_PORT,
  DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL,
  VALID_CHANNELS,
  inferDefaultChannel,
  getOAuthProtocol,
  isElectronBinaryExec,
  parseAuthBridgePort,
  resolveAppChannel,
  shouldRegisterProtocolWithAppArg,
};

