const fs = require("fs");
const path = require("path");
const { deleteWindowsPathByHandleSync } = require("./windowsHandleDelete");

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

const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_FILES = 7;
const DEFAULT_MAX_RECORD_BYTES = 128 * 1024;
const DEFAULT_MAX_PENDING_BYTES = 2 * 1024 * 1024;

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sameIdentity = (first, second) =>
  Boolean(
    first &&
    second &&
    String(first.dev) === String(second.dev) &&
    String(first.ino) === String(second.ino) &&
    first.isDirectory() === second.isDirectory() &&
    first.isFile() === second.isFile()
  );

const toWindowsIdentity = (stat) => ({
  volumeSerialNumber: String(stat?.dev ?? ""),
  fileIndex: String(stat?.ino ?? ""),
});

const assertNoLinkedAncestorsSync = (directory) => {
  let current = path.resolve(directory);
  while (true) {
    const stat = fs.lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Telemetry logs path contains a linked or invalid ancestor");
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
};

class TelemetryFileLogger {
  constructor(options = {}) {
    this.enabled = false;
    this.logsDir = options.logsDir || null;
    this.filePrefix = options.filePrefix || "echodraft-debug";
    this.getNow = typeof options.getNow === "function" ? options.getNow : () => new Date();
    this.getHeaderRecord =
      typeof options.getHeaderRecord === "function" ? options.getHeaderRecord : () => null;
    this.maxFileBytes = options.maxFileBytes || DEFAULT_MAX_FILE_BYTES;
    this.maxTotalBytes = options.maxTotalBytes || DEFAULT_MAX_TOTAL_BYTES;
    this.maxFiles = options.maxFiles || DEFAULT_MAX_FILES;
    this.maxRecordBytes = options.maxRecordBytes || DEFAULT_MAX_RECORD_BYTES;
    this.maxPendingBytes = options.maxPendingBytes || DEFAULT_MAX_PENDING_BYTES;
    this.platform = options.platform || process.platform;
    this.deleteWindowsPathByHandleSync =
      options.deleteWindowsPathByHandleSync || deleteWindowsPathByHandleSync;

    this.currentDateKey = null;
    this.currentLogPath = null;
    this.currentBytes = 0;
    this.totalBytes = 0;
    this.pendingBytes = 0;
    this.stream = null;
    this.logsDirHandle = null;
    this.logsDirStat = null;
    this.windowsLogsDirIdentity = null;
    this.currentFileStat = null;
    this.logicalFileBytes = new Map();
    this.sealedPaths = new Set();
    this.writeFailed = false;
    this.failedDateKey = null;
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
    if (next) {
      this.writeFailed = false;
      this.failedDateKey = null;
    }
    if (!this.enabled) {
      this.close();
      this.releaseLogsDirectory();
    }
  }

  setLogsDir(logsDir) {
    if (this.logsDir !== (logsDir || null)) {
      this.close();
      this.releaseLogsDirectory();
    }
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
    this.currentBytes = 0;
    this.currentFileStat = null;
  }

  releaseLogsDirectory() {
    if (this.logsDirHandle !== null) {
      try {
        fs.closeSync(this.logsDirHandle);
      } catch {
        // Best-effort descriptor release during shutdown or path changes.
      }
    }
    this.logsDirHandle = null;
    this.logsDirStat = null;
    this.windowsLogsDirIdentity = null;
  }

  verifyLogsDirectory() {
    if (this.logsDirHandle === null || !this.logsDirStat || !this.logsDir) return false;
    try {
      const handleStat = fs.fstatSync(this.logsDirHandle, { bigint: true });
      const pathStat = fs.lstatSync(this.logsDir, { bigint: true });
      if (
        pathStat.isSymbolicLink() ||
        !pathStat.isDirectory() ||
        !sameIdentity(this.logsDirStat, handleStat) ||
        !sameIdentity(this.logsDirStat, pathStat)
      ) {
        return false;
      }
      const finalPath = fs.realpathSync.native?.(this.logsDir) || fs.realpathSync(this.logsDir);
      const finalStat = fs.lstatSync(finalPath, { bigint: true });
      return sameIdentity(this.logsDirStat, finalStat);
    } catch {
      return false;
    }
  }

  ensureVerifiedLogsDirectory() {
    if (!this.logsDir || !path.isAbsolute(this.logsDir)) return false;
    if (this.logsDirHandle !== null) return this.verifyLogsDirectory();
    try {
      fs.mkdirSync(this.logsDir, { recursive: true, mode: 0o700 });
      assertNoLinkedAncestorsSync(this.logsDir);
      const pathStat = fs.lstatSync(this.logsDir, { bigint: true });
      const handle = fs.openSync(this.logsDir, "r");
      const handleStat = fs.fstatSync(handle, { bigint: true });
      if (!sameIdentity(pathStat, handleStat)) {
        fs.closeSync(handle);
        return false;
      }
      this.logsDirHandle = handle;
      this.logsDirStat = pathStat;
      if (!this.verifyLogsDirectory()) {
        this.releaseLogsDirectory();
        return false;
      }
      if (this.platform === "win32") {
        // Node exposes the native Windows volume serial and file index as dev/ino.
        this.windowsLogsDirIdentity = toWindowsIdentity(pathStat);
      }
      return true;
    } catch {
      this.releaseLogsDirectory();
      return false;
    }
  }

  verifyCurrentStreamTarget() {
    if (!this.isStreamUsable() || !this.currentLogPath || !this.currentFileStat) return false;
    if (!this.verifyLogsDirectory()) return false;
    try {
      const descriptorStat = fs.fstatSync(this.stream.fd, { bigint: true });
      const pathStat = fs.lstatSync(this.currentLogPath, { bigint: true });
      return (
        !pathStat.isSymbolicLink() &&
        pathStat.isFile() &&
        sameIdentity(this.currentFileStat, descriptorStat) &&
        sameIdentity(this.currentFileStat, pathStat)
      );
    } catch {
      return false;
    }
  }

  async closeAndWait({ timeoutMs = 2000 } = {}) {
    const stream = this.stream;
    this.stream = null;
    this.currentDateKey = null;
    this.currentLogPath = null;
    this.currentBytes = 0;
    this.currentFileStat = null;

    if (!stream) {
      return true;
    }

    return await new Promise((resolve) => {
      let settled = false;
      let timeoutId = null;
      const finish = (success) => {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        stream.removeListener("error", handleError);
        if (!success && !stream.destroyed) {
          try {
            stream.destroy();
          } catch {
            // Best-effort shutdown after a close error or timeout.
          }
        }
        resolve(success);
      };
      const handleError = () => finish(false);
      try {
        if (stream.writableEnded || stream.writableFinished || stream.destroyed) {
          finish(true);
          return;
        }
        stream.once("error", handleError);
        timeoutId = setTimeout(() => finish(false), Math.max(100, timeoutMs));
        timeoutId.unref?.();
        stream.end(() => finish(true));
      } catch {
        finish(false);
      }
    });
  }

  getManagedFiles() {
    if (!this.logsDir || !this.ensureVerifiedLogsDirectory()) return [];
    const pattern = new RegExp(
      `^${escapeRegExp(this.filePrefix)}-\\d{4}-\\d{2}-\\d{2}(?:-part-\\d{3})?\\.jsonl$`,
      "i"
    );
    try {
      return fs
        .readdirSync(this.logsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && pattern.test(entry.name))
        .slice(0, 1000)
        .map((entry) => {
          const filePath = path.join(this.logsDir, entry.name);
          const stat = fs.lstatSync(filePath, { bigint: true });
          return stat.isFile() && !stat.isSymbolicLink()
            ? {
                filePath,
                name: entry.name,
                size: Math.max(Number(stat.size), this.logicalFileBytes.get(filePath) || 0),
                mtimeMs: Number(stat.mtimeMs),
              }
            : null;
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  enforceRetention({ reserveBytes = 0, preservePath = null, requireSlot = false } = {}) {
    const files = this.getManagedFiles().sort((left, right) => left.mtimeMs - right.mtimeMs);
    const livePaths = new Set(files.map((file) => file.filePath));
    for (const trackedPath of this.logicalFileBytes.keys()) {
      if (!livePaths.has(trackedPath) && trackedPath !== this.currentLogPath) {
        this.logicalFileBytes.delete(trackedPath);
        this.sealedPaths.delete(trackedPath);
      }
    }
    let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    let fileCount = files.length;
    for (const file of files) {
      const overCount = requireSlot ? fileCount >= this.maxFiles : fileCount > this.maxFiles;
      if (!overCount && totalBytes + reserveBytes <= this.maxTotalBytes) break;
      if (file.filePath === preservePath) continue;
      try {
        if (!this.verifyLogsDirectory()) break;
        const beforeDelete = fs.lstatSync(file.filePath, { bigint: true });
        if (beforeDelete.isSymbolicLink() || !beforeDelete.isFile()) continue;
        if (this.platform === "win32") {
          const targetIdentity = toWindowsIdentity(beforeDelete);
          const deletion = this.deleteWindowsPathByHandleSync(this.logsDir, file.filePath, {
            expectDirectory: false,
            expectedRootIdentity: this.windowsLogsDirIdentity,
            expectedTargetIdentity: targetIdentity,
          });
          if (!deletion?.success) continue;
        } else {
          const immediatelyBeforeDelete = fs.lstatSync(file.filePath, { bigint: true });
          if (!sameIdentity(beforeDelete, immediatelyBeforeDelete)) continue;
          fs.unlinkSync(file.filePath);
        }
        this.logicalFileBytes.delete(file.filePath);
        this.sealedPaths.delete(file.filePath);
        totalBytes -= file.size;
        fileCount -= 1;
      } catch {
        // Keep the hard byte/count check below fail-closed if an old file is locked.
      }
    }
    this.totalBytes = Math.max(0, totalBytes);
    return {
      allowed:
        fileCount <= this.maxFiles &&
        (!requireSlot || fileCount < this.maxFiles) &&
        this.totalBytes + reserveBytes <= this.maxTotalBytes,
      fileCount,
      totalBytes: this.totalBytes,
    };
  }

  getCandidatePath(dateKey, requiredBytes) {
    const baseName = `${this.filePrefix}-${dateKey}`;
    const matching = this.getManagedFiles()
      .map((file) => {
        const match = file.name.match(
          new RegExp(`^${escapeRegExp(baseName)}(?:-part-(\\d{3}))?\\.jsonl$`, "i")
        );
        if (!match) return null;
        return { ...file, part: match[1] ? Number(match[1]) : 0 };
      })
      .filter(Boolean)
      .sort((left, right) => right.part - left.part);
    const latest = matching[0];
    if (
      latest &&
      !this.sealedPaths.has(latest.filePath) &&
      latest.size + requiredBytes <= this.maxFileBytes
    ) {
      return { filePath: latest.filePath, part: latest.part, isNew: false };
    }
    const part = latest ? latest.part + 1 : 0;
    if (part > 999) return null;
    const suffix = part === 0 ? "" : `-part-${String(part).padStart(3, "0")}`;
    return {
      filePath: path.join(this.logsDir, `${baseName}${suffix}.jsonl`),
      part,
      isNew: true,
    };
  }

  handleStreamError(error) {
    this.writeFailed = true;
    this.failedDateKey = this.currentDateKey;
    const stream = this.stream;
    this.stream = null;
    this.currentLogPath = null;
    this.currentBytes = 0;
    this.currentFileStat = null;
    try {
      if (stream && !stream.destroyed) stream.destroy();
    } catch {
      // Disk-full and stream teardown must never crash the app.
    }
    return error;
  }

  writeLine(line) {
    if (!this.verifyCurrentStreamTarget()) {
      this.close();
      return false;
    }
    const bytes = Buffer.byteLength(line, "utf8");
    if (
      bytes > this.maxRecordBytes ||
      this.currentBytes + bytes > this.maxFileBytes ||
      this.pendingBytes + bytes > this.maxPendingBytes
    ) {
      return false;
    }
    if (this.totalBytes + bytes > this.maxTotalBytes) {
      const retention = this.enforceRetention({
        reserveBytes: bytes,
        preservePath: this.currentLogPath,
      });
      if (!retention.allowed) return false;
    }

    this.pendingBytes += bytes;
    try {
      this.stream.write(line, () => {
        this.pendingBytes = Math.max(0, this.pendingBytes - bytes);
      });
      this.currentBytes += bytes;
      this.totalBytes += bytes;
      this.logicalFileBytes.set(this.currentLogPath, this.currentBytes);
      return true;
    } catch (error) {
      this.pendingBytes = Math.max(0, this.pendingBytes - bytes);
      this.handleStreamError(error);
      return false;
    }
  }

  ensureStream(requiredBytes = 0) {
    if (!this.enabled || !this.logsDir) {
      return false;
    }

    const now = this.getNow();
    const dateKey = getLocalDateKey(now);
    if (this.writeFailed) {
      if (this.failedDateKey === dateKey) return false;
      this.writeFailed = false;
      this.failedDateKey = null;
    }

    if (
      this.isStreamUsable() &&
      this.currentDateKey === dateKey &&
      this.currentBytes + requiredBytes <= this.maxFileBytes
    ) {
      if (this.verifyCurrentStreamTarget()) return true;
    }

    if (
      this.isStreamUsable() &&
      this.currentDateKey === dateKey &&
      this.currentLogPath &&
      this.currentBytes + requiredBytes > this.maxFileBytes
    ) {
      this.sealedPaths.add(this.currentLogPath);
    }

    this.close();

    if (!this.ensureVerifiedLogsDirectory()) return false;

    const candidate = this.getCandidatePath(dateKey, requiredBytes);
    if (!candidate) return false;
    const retention = this.enforceRetention({
      reserveBytes: requiredBytes,
      preservePath: candidate.filePath,
      requireSlot: candidate.isNew,
    });
    if (!retention.allowed) return false;
    const logPath = candidate.filePath;
    this.currentDateKey = dateKey;
    this.currentLogPath = logPath;

    let shouldWriteHeader = true;
    let fileDescriptor = null;
    try {
      // Open synchronously and hand this exact descriptor to the stream. A separate
      // asynchronous open could recreate a log after retention had already deleted it.
      const priorStat = (() => {
        try {
          return fs.lstatSync(logPath, { bigint: true });
        } catch (error) {
          if (error?.code === "ENOENT") return null;
          throw error;
        }
      })();
      if (priorStat && (priorStat.isSymbolicLink() || !priorStat.isFile())) return false;
      fileDescriptor = fs.openSync(logPath, candidate.isNew ? "ax" : "a", 0o600);
      const stats = fs.fstatSync(fileDescriptor, { bigint: true });
      const pathStat = fs.lstatSync(logPath, { bigint: true });
      if (
        !stats.isFile() ||
        pathStat.isSymbolicLink() ||
        !pathStat.isFile() ||
        !sameIdentity(stats, pathStat) ||
        !this.verifyLogsDirectory()
      ) {
        fs.closeSync(fileDescriptor);
        fileDescriptor = null;
        return false;
      }
      shouldWriteHeader = stats.size === 0n;
      this.currentBytes = Number(stats.size);
      this.currentFileStat = stats;
      this.logicalFileBytes.set(logPath, Number(stats.size));
    } catch {
      return false;
    }

    try {
      this.stream = fs.createWriteStream(logPath, {
        fd: fileDescriptor,
        flags: "a",
        autoClose: true,
      });
      fileDescriptor = null;
      this.stream.on("error", (error) => this.handleStreamError(error));
    } catch {
      if (fileDescriptor !== null) {
        try {
          fs.closeSync(fileDescriptor);
        } catch {
          // Best-effort cleanup after stream construction failed.
        }
      }
      this.close();
      return false;
    }

    if (shouldWriteHeader) {
      try {
        const header = this.getHeaderRecord();
        if (header) {
          const line = `${safeJsonStringify(header)}\n`;
          if (
            this.currentBytes + Buffer.byteLength(line, "utf8") + requiredBytes <=
            this.maxFileBytes
          ) {
            this.writeLine(line);
          }
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

    try {
      const line = `${safeJsonStringify(record)}\n`;
      const bytes = Buffer.byteLength(line, "utf8");
      if (bytes > this.maxRecordBytes || bytes > this.maxFileBytes) return false;
      if (!this.ensureStream(bytes)) return false;
      if (this.currentBytes + bytes > this.maxFileBytes) {
        this.close();
        if (!this.ensureStream(bytes)) return false;
      }
      return this.writeLine(line);
    } catch {
      return false;
    }
  }
}

module.exports = {
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_PENDING_BYTES,
  DEFAULT_MAX_RECORD_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  TelemetryFileLogger,
  getLocalDateKey,
  safeJsonStringify,
};
