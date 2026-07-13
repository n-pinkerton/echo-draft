const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const { purgeDebugArtifactsAtRoot } = require("../debugArtifacts");
const { TelemetryFileLogger } = require("../telemetryFileLogger");
const { redactEnvSnapshot } = require("./envSnapshot");
const { buildHeaderRecord } = require("./headerRecord");
const { formatArgs, formatMeta } = require("./formatters");
const { redactSensitiveData, redactSensitiveString } = require("./redaction");
const {
  logAudioData,
  logFFmpegDebug,
  logProcessOutput,
  logProcessStart,
  logSTTPipeline,
  logWhisperPipeline,
} = require("./debugHelpers");
const { getInstallDir, getLogsDirCandidates } = require("./logPaths");
const { LOG_LEVELS, normalizeLevel, resolveLogLevel } = require("./logLevelUtils");

class DebugLogger {
  constructor() {
    this.logLevel = this.resolveLogLevel();
    this.levelValue = LOG_LEVELS[this.logLevel] || LOG_LEVELS.info;
    this.debugMode = this.isDebugEnabled();
    this.fileLoggingEnabled = false;
    this.fileLoggingPending = this.debugMode;
    this.logsDir = null;
    this.logsDirSource = null;
    this.nextFileLoggingInitAttemptAt = 0;
    this.lastFileLoggingInitError = null;

    this.telemetryLogger = new TelemetryFileLogger({
      filePrefix: "echodraft-debug",
      getHeaderRecord: () => this.buildHeaderRecord(),
    });
  }

  getInstallDir() {
    return getInstallDir(app);
  }

  getLogsDirCandidates() {
    return getLogsDirCandidates(app);
  }

  buildHeaderRecord() {
    return buildHeaderRecord({
      app,
      logLevel: this.logLevel,
      logsDir: this.logsDir,
      logsDirSource: this.logsDirSource,
      getInstallDir: () => this.getInstallDir(),
      redactEnvSnapshot,
    });
  }

  initializeFileLogging() {
    if (this.fileLoggingEnabled) return;
    if (!app.isReady()) {
      return;
    }

    const nowMs = Date.now();
    if (nowMs < this.nextFileLoggingInitAttemptAt) {
      return;
    }

    let lastError = null;
    const candidates = this.getLogsDirCandidates();

    for (const candidate of candidates) {
      try {
        fs.mkdirSync(candidate.dir, { recursive: true });
        fs.accessSync(candidate.dir, fs.constants.W_OK);

        this.logsDir = candidate.dir;
        this.logsDirSource = candidate.source;
        this.telemetryLogger.setLogsDir(candidate.dir);
        this.telemetryLogger.setEnabled(true);

        if (!this.telemetryLogger.ensureStream()) {
          throw new Error("Failed to open daily log file");
        }

        this.fileLoggingEnabled = true;
        this.fileLoggingPending = false;
        this.nextFileLoggingInitAttemptAt = 0;
        this.lastFileLoggingInitError = null;

        this.debug("Debug logging enabled", { logPath: this.telemetryLogger.getLogPath() });
        this.info("System Info", {
          platform: process.platform,
          nodeVersion: process.version,
          electronVersion: process.versions.electron,
          appPath: app.getAppPath(),
          userDataPath: app.getPath("userData"),
          resourcesPath: process.resourcesPath,
          environment: process.env.NODE_ENV,
        });

        return;
      } catch (error) {
        lastError = error;
        try {
          this.telemetryLogger.setEnabled(false);
        } catch {
          // Ignore shutdown errors
        }
      }
    }

    this.fileLoggingEnabled = false;
    this.fileLoggingPending = this.debugMode;
    this.lastFileLoggingInitError = lastError?.message || String(lastError || "unknown error");
    this.nextFileLoggingInitAttemptAt = nowMs + 5000;

    console.error("Failed to initialize debug logging:", lastError);
  }

  ensureFileLogging() {
    if (!this.debugMode) {
      return;
    }

    if (this.fileLoggingEnabled) {
      return;
    }

    this.fileLoggingPending = true;
    this.initializeFileLogging();
  }

  resolveLogLevel() {
    return resolveLogLevel();
  }

  refreshLogLevel() {
    const nextLevel = this.resolveLogLevel();
    const didChange = nextLevel !== this.logLevel;

    this.logLevel = nextLevel;
    this.levelValue = LOG_LEVELS[this.logLevel] || LOG_LEVELS.info;
    this.debugMode = this.isDebugEnabled();

    if (this.debugMode) {
      this.fileLoggingPending = true;
      this.ensureFileLogging();
    } else {
      this.fileLoggingPending = false;
      this.fileLoggingEnabled = false;
      this.lastFileLoggingInitError = null;
      this.telemetryLogger.setEnabled(false);
    }

    return didChange;
  }

  getLevel() {
    return this.logLevel;
  }

  isDebugEnabled() {
    return this.levelValue <= LOG_LEVELS.debug;
  }

  shouldLog(level) {
    const normalized = normalizeLevel(level) || "info";
    return LOG_LEVELS[normalized] >= this.levelValue;
  }

  formatArgs(args) {
    return formatArgs(redactSensitiveData(args));
  }

  formatMeta(meta) {
    return formatMeta(meta);
  }

  write(level, message, meta, scope, source) {
    const normalized = normalizeLevel(level) || "info";
    if (!this.shouldLog(normalized)) return;

    if (this.fileLoggingPending && !this.fileLoggingEnabled) {
      this.initializeFileLogging();
    }

    const timestamp = new Date().toISOString();
    const safeMessage = redactSensitiveString(String(message));
    const safeMeta = meta === undefined ? undefined : redactSensitiveData(meta);
    const scopeTag = scope ? `[${scope}]` : "";
    const sourceTag = source ? `[${source}]` : "";
    const levelTag = `[${normalized.toUpperCase()}]`;

    const consoleFn =
      normalized === "error" || normalized === "fatal"
        ? console.error
        : normalized === "warn"
          ? console.warn
          : console.log;

    if (meta !== undefined) {
      consoleFn(`${levelTag}${scopeTag}${sourceTag} ${safeMessage}`, safeMeta);
    } else {
      consoleFn(`${levelTag}${scopeTag}${sourceTag} ${safeMessage}`);
    }

    if (this.fileLoggingEnabled) {
      const record = {
        ts: timestamp,
        level: normalized,
        scope: scope || null,
        source: source || "main",
        message: safeMessage,
        meta: safeMeta === undefined ? null : safeMeta,
        pid: process.pid,
      };
      this.telemetryLogger.write(record);
    }
  }

  log(...args) {
    this.write("debug", this.formatArgs(args));
  }

  debug(message, meta, scope, source) {
    this.write("debug", message, meta, scope, source);
  }

  trace(message, meta, scope, source) {
    this.write("trace", message, meta, scope, source);
  }

  info(message, meta, scope, source) {
    this.write("info", message, meta, scope, source);
  }

  warn(message, meta, scope, source) {
    this.write("warn", message, meta, scope, source);
  }

  logReasoning(stage, details) {
    this.debug(stage, details, "reasoning");
  }

  error(...args) {
    const message = `ERROR: ${this.formatArgs(args)}`;
    this.write("error", message);
  }

  fatal(...args) {
    const message = `FATAL: ${this.formatArgs(args)}`;
    this.write("fatal", message);
  }

  logEntry(entry) {
    if (!entry || typeof entry !== "object") return;
    const normalized = normalizeLevel(entry.level) || "info";
    const message = entry.message ? String(entry.message) : "";
    const scope = entry.scope ? String(entry.scope) : undefined;
    const source = entry.source ? String(entry.source) : "renderer";
    this.write(normalized, message, entry.meta, scope, source);
  }

  logFFmpegDebug(context, ffmpegPath, additionalInfo = {}) {
    logFFmpegDebug(this, context, ffmpegPath, additionalInfo);
  }

  logAudioData(context, audioBlob) {
    logAudioData(this, context, audioBlob);
  }

  logProcessStart(command, args, options = {}) {
    logProcessStart(this, command, args, options);
  }

  logProcessOutput(processName, type, data) {
    logProcessOutput(this, processName, type, data);
  }

  logWhisperPipeline(stage, details) {
    logWhisperPipeline(this, stage, details);
  }

  logSTTPipeline(stage, details) {
    logSTTPipeline(this, stage, details);
  }

  getLogPath() {
    return this.telemetryLogger.getLogPath();
  }

  getLogsDirSource() {
    return this.logsDirSource;
  }

  isFileLoggingEnabled() {
    return Boolean(this.fileLoggingEnabled);
  }

  getFileLoggingError() {
    return this.lastFileLoggingInitError;
  }

  getLogsDir() {
    return this.telemetryLogger.getLogsDir();
  }

  getArtifactLogsDir() {
    const current = this.telemetryLogger.getLogsDir() || this.logsDir;
    if (current) return current;

    const candidates = this.getLogsDirCandidates();
    const existing = candidates.find((candidate) => {
      try {
        return fs.existsSync(candidate.dir);
      } catch {
        return false;
      }
    });
    return existing?.dir || candidates[0]?.dir || null;
  }

  getDebugArtifactRoots() {
    const roots = [];
    const seen = new Set();
    const candidates = [
      this.telemetryLogger.getLogsDir(),
      this.logsDir,
      ...this.getLogsDirCandidates().map((candidate) => candidate.dir),
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      const resolved = path.resolve(candidate);
      const identity = process.platform === "win32" ? resolved.toLowerCase() : resolved;
      if (seen.has(identity)) continue;
      seen.add(identity);
      try {
        if (fs.existsSync(resolved)) roots.push(resolved);
      } catch {
        // Ignore inaccessible fallback locations; the active root is reported below if needed.
      }
    }
    return roots;
  }

  async purgeArtifacts() {
    const roots = this.getDebugArtifactRoots();
    const shouldResumeFileLogging = this.debugMode;

    this.fileLoggingEnabled = false;
    this.fileLoggingPending = false;
    await this.telemetryLogger.closeAndWait();

    const rootResults = roots.map((root) => purgeDebugArtifactsAtRoot(root));
    const result = rootResults.reduce(
      (summary, entry) => ({
        filesDeleted: summary.filesDeleted + entry.filesDeleted,
        directoriesDeleted: summary.directoriesDeleted + entry.directoriesDeleted,
        bytesDeleted: summary.bytesDeleted + entry.bytesDeleted,
        preservedEntries: summary.preservedEntries + entry.preservedEntries,
        errors: [...summary.errors, ...entry.errors],
      }),
      { filesDeleted: 0, directoriesDeleted: 0, bytesDeleted: 0, preservedEntries: 0, errors: [] }
    );

    if (shouldResumeFileLogging) {
      this.fileLoggingPending = true;
      this.ensureFileLogging();
    }

    return {
      ...result,
      rootsScanned: roots.length,
      success: result.errors.length === 0,
      freshLogStarted: shouldResumeFileLogging && this.fileLoggingEnabled,
    };
  }

  isEnabled() {
    return this.isDebugEnabled();
  }

  close() {
    this.telemetryLogger.setEnabled(false);
    this.telemetryLogger.close();
  }
}

module.exports = { DebugLogger };
