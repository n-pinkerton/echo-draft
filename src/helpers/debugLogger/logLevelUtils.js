const LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const normalizeLevel = (value) => {
  if (!value) return null;
  const lower = String(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(LOG_LEVELS, lower) ? lower : null;
};

const readArgLogLevel = (argv = process.argv || []) => {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--log-level" && argv[i + 1]) {
      return argv[i + 1];
    }
    if (typeof arg === "string" && arg.startsWith("--log-level=")) {
      return arg.split("=", 2)[1];
    }
  }
  return null;
};

const resolveLogLevel = ({ argv = process.argv, env = process.env } = {}) => {
  const argLevel = normalizeLevel(readArgLogLevel(argv));
  if (argLevel) {
    return argLevel;
  }

  const envLevel = normalizeLevel(env?.OPENWHISPR_LOG_LEVEL || env?.LOG_LEVEL);
  if (envLevel) {
    return envLevel;
  }

  return "info";
};

module.exports = {
  LOG_LEVELS,
  normalizeLevel,
  readArgLogLevel,
  resolveLogLevel,
};

