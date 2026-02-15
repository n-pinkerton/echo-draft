const fs = require("fs");
const path = require("path");

const pad2 = (value) => String(value).padStart(2, "0");

const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
};

const safeJsonStringify = (value) => {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "bigint") {
      return v.toString();
    }
    if (typeof v === "object" && v !== null) {
      if (seen.has(v)) {
        return "[Circular]";
      }
      seen.add(v);
    }
    if (typeof v === "function") {
      return `[Function ${v.name || "anonymous"}]`;
    }
    return v;
  });
};

class TelemetryFileLogger {
  constructor(options = {}) {
    this.enabled = false;
    this.logsDir = options.logsDir || null;
    this.filePrefix = options.filePrefix || "openwhispr-debug";
    this.getNow = typeof options.getNow === "function" ? options.getNow : () => new Date();
    this.getHeaderRecord =
      typeof options.getHeaderRecord === "function" ? options.getHeaderRecord : () => null;

    this.currentDateKey = null;
    this.currentLogPath = null;
    this.stream = null;
  }

  isStreamUsable() {
    if (!this.stream) {
      return false;
    }
    if (this.stream.destroyed) {
      return false;
    }
    if (this.stream.writableEnded || this.stream.writableFinished) {
      return false;
    }
    return true;
  }

  setEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.enabled === next) {
      return;
    }
    this.enabled = next;
    if (!this.enabled) {
      this.close();
    }
  }

  setLogsDir(logsDir) {
    this.logsDir = logsDir || null;
  }

  getLogsDir() {
    return this.logsDir;
  }

  getLogPath() {
    return this.currentLogPath;
  }

  close() {
    if (this.stream) {
      try {
        this.stream.end();
      } catch {
        // Ignore close errors
      }
    }
    this.stream = null;
    this.currentDateKey = null;
    this.currentLogPath = null;
  }

  ensureStream() {
    if (!this.enabled || !this.logsDir) {
      return false;
    }

    const now = this.getNow();
    const dateKey = getLocalDateKey(now);

    if (this.isStreamUsable() && this.currentDateKey === dateKey) {
      // If the file was deleted or moved externally, recreate it.
      try {
        if (this.currentLogPath && fs.existsSync(this.currentLogPath)) {
          return true;
        }
      } catch {
        // Fall through to re-open below.
      }
    }

    this.close();

    try {
      fs.mkdirSync(this.logsDir, { recursive: true });
    } catch {
      return false;
    }

    const logPath = path.join(this.logsDir, `${this.filePrefix}-${dateKey}.jsonl`);
    this.currentDateKey = dateKey;
    this.currentLogPath = logPath;

    let shouldWriteHeader = true;
    try {
      // Ensure the file exists before we create the stream. `fs.createWriteStream`
      // opens the file asynchronously, which can lead to racy reads in tests and
      // external tooling that expects the file to exist immediately.
      const fd = fs.openSync(logPath, "a");
      fs.closeSync(fd);
      const stats = fs.statSync(logPath);
      shouldWriteHeader = stats.size === 0;
    } catch {
      shouldWriteHeader = true;
    }

    try {
      this.stream = fs.createWriteStream(logPath, { flags: "a" });
    } catch {
      this.close();
      return false;
    }

    if (shouldWriteHeader) {
      try {
        const header = this.getHeaderRecord();
        if (header) {
          const line = safeJsonStringify(header);
          this.stream.write(`${line}\n`);
        }
      } catch {
        // Ignore header write failures (keep logger usable)
      }
    }

    return true;
  }

  async flush() {
    if (!this.enabled) {
      return false;
    }

    if (!this.ensureStream() || !this.stream) {
      return false;
    }

    return await new Promise((resolve) => {
      try {
        this.stream.write("", () => resolve(true));
      } catch {
        resolve(false);
      }
    });
  }

  write(record) {
    if (!this.enabled) {
      return false;
    }

    if (!this.ensureStream()) {
      return false;
    }

    try {
      const line = safeJsonStringify(record);
      this.stream.write(`${line}\n`);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = {
  TelemetryFileLogger,
  getLocalDateKey,
  safeJsonStringify,
};
