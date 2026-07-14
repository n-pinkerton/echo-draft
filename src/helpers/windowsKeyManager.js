/**
 * WindowsKeyManager - Handles key up/down detection for Push-to-Talk on Windows
 *
 * Uses a native Windows keyboard hook to detect when specific keys are
 * pressed and released, enabling Push-to-Talk functionality.
 */

const { spawn } = require("child_process");
const path = require("path");
const EventEmitter = require("events");
const fs = require("fs");
const debugLogger = require("./debugLogger");
const { createNativeLineDecoder } = require("./hotkey/nativeLineProtocol");

const DEFAULT_READY_TIMEOUT_MS = 3_000;

class WindowsKeyManager extends EventEmitter {
  constructor({
    spawnFn = spawn,
    readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {}) {
    super();
    this.spawnProcess = spawnFn;
    this.readyTimeoutMs = readyTimeoutMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.listenerProcesses = new Map();
    // A helper remains here until Windows confirms process exit. This prevents a replacement
    // from racing an old RegisterHotKey owner after a shutdown timeout.
    this.retiringProcesses = new Map();
    this.isSupported = process.platform === "win32";
    this.hasReportedError = false;
  }

  /**
   * Start listening for the specified key
   * @param {string} key - The key to listen for (e.g., "`", "F8", "F11", "CommandOrControl+F11")
   * @param {string} hotkeyId - Identifier for the hotkey route (e.g., "insert" | "clipboard")
   */
  start(key = "`", hotkeyId = "insert", { mode = "hook" } = {}) {
    if (!this.isSupported) {
      return;
    }

    const existingListener = this.listenerProcesses.get(hotkeyId);
    if (existingListener && existingListener.key === key && existingListener.mode === mode) {
      return true;
    }

    if (existingListener) {
      // Replacement is deliberately asynchronous: the lifecycle controller must await
      // stopAndWait() before asking this manager to start the new helper.
      this.stop(hotkeyId);
      return false;
    }
    if (this.hasRetiringProcess(hotkeyId)) {
      debugLogger.warn("[WindowsKeyManager] Refusing to overlap a retiring key listener", {
        hotkeyId,
        key,
        mode,
      });
      return false;
    }

    const listenerPath = this.resolveListenerBinary();
    if (!listenerPath) {
      // Binary not found - this is OK, Push-to-Talk will use fallback mode
      this.emit("unavailable", new Error("Windows key listener binary not found"), {
        hotkeyId,
        key,
        mode,
      });
      return false;
    }

    this.hasReportedError = false;

    debugLogger.debug("[WindowsKeyManager] Starting key listener", {
      hotkeyId,
      key,
      mode,
      binaryPath: listenerPath,
    });

    let listenerProcess = null;
    try {
      const args = mode === "tap" ? [key, "--tap"] : [key];
      listenerProcess = this.spawnProcess(listenerPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      debugLogger.error("[WindowsKeyManager] Failed to spawn process", { error: error.message });
      this.reportError(error, { hotkeyId, key, mode, reason: "spawn_error" });
      return false;
    }

    const listener = {
      process: listenerProcess,
      key,
      mode,
      isReady: false,
      stdoutHandler: null,
      stderrHandler: null,
      protocolDecoder: null,
      readyTimer: null,
    };
    this.listenerProcesses.set(hotkeyId, listener);
    const isCurrentListener = () =>
      this.listenerProcesses.get(hotkeyId)?.process === listenerProcess;

    listenerProcess.stdout.setEncoding("utf8");
    const handleProtocolLine = (rawLine) => {
      if (!isCurrentListener()) return;
      const line = rawLine.trim();
      if (!line) return;
      if (line === "READY") {
        if (listener.isReady) return;
        debugLogger.debug("[WindowsKeyManager] Listener ready", { hotkeyId, key });
        listener.isReady = true;
        this.clearReadyTimer(listener);
        this.emit("ready", { hotkeyId, key, mode });
      } else if (line === "KEY_DOWN") {
        debugLogger.debug("[WindowsKeyManager] KEY_DOWN detected", { hotkeyId, key });
        this.emit("key-down", key, hotkeyId);
      } else if (line === "KEY_UP") {
        debugLogger.debug("[WindowsKeyManager] KEY_UP detected", { hotkeyId, key });
        this.emit("key-up", key, hotkeyId);
      } else {
        debugLogger.debug("[WindowsKeyManager] Unknown output", { line });
      }
    };
    listener.protocolDecoder = createNativeLineDecoder(handleProtocolLine, {
      onOverflow: (discardedLength) => {
        debugLogger.warn("[WindowsKeyManager] Discarded malformed native protocol output", {
          hotkeyId,
          discardedLength,
        });
      },
    });
    listener.stdoutHandler = (chunk) => {
      if (!isCurrentListener()) return;
      listener.protocolDecoder.push(chunk);
    };
    listenerProcess.stdout.on("data", listener.stdoutHandler);

    listener.readyTimer = this.setTimeoutFn(() => {
      if (!isCurrentListener() || listener.isReady) return;
      const error = new Error(`Windows key listener "${hotkeyId}" did not become ready in time`);
      this.retireListener(hotkeyId, listener, {
        emitStopped: true,
        reason: "ready_timeout",
      });
      this.reportError(error, { hotkeyId, key, mode, reason: "ready_timeout" });
    }, this.readyTimeoutMs);
    listener.readyTimer.unref?.();

    listenerProcess.stderr.setEncoding("utf8");
    listener.stderrHandler = (data) => {
      if (!isCurrentListener()) return;
      const message = data.toString().trim();
      if (message.length > 0) {
        // Native binary logs to stderr for info messages, don't treat as error
        debugLogger.debug("[WindowsKeyManager] Native stderr", { message });
      }
    };
    listenerProcess.stderr.on("data", listener.stderrHandler);

    listenerProcess.on("error", (error) => {
      if (!isCurrentListener()) {
        this.clearRetiringProcessIfExited(listenerProcess);
        return;
      }
      this.retireListener(hotkeyId, listener, { reason: "process_error" });
      this.reportError(error, { hotkeyId, key, mode, reason: "process_error" });
    });

    listenerProcess.on("exit", (code, signal) => {
      const wasCurrentListener = isCurrentListener();
      if (wasCurrentListener) {
        this.detachListenerOutput(listener);
        this.listenerProcesses.delete(hotkeyId);
      }

      const retirement = this.retiringProcesses.get(listenerProcess);
      if (retirement) {
        this.retiringProcesses.delete(listenerProcess);
        this.emit("retirement-confirmed", retirement);
        return;
      }
      if (!wasCurrentListener) return;

      this.emit("route-stopped", {
        hotkeyId,
        key,
        mode,
        reason: "exit",
        code,
        signal,
      });

      if (code !== 0) {
        const error = new Error(
          `Windows key listener "${hotkeyId}" exited with code ${code ?? "null"} signal ${signal ?? "null"}`
        );
        this.reportError(error, { hotkeyId, key, mode, reason: "nonzero_exit" });
      }
    });

    listenerProcess.on("close", () => {
      const retirement = this.retiringProcesses.get(listenerProcess);
      if (!retirement) return;
      this.retiringProcesses.delete(listenerProcess);
      this.emit("retirement-confirmed", retirement);
    });

    return true;
  }

  /**
   * Stop the key listener
   */
  stop(hotkeyId = null) {
    if (hotkeyId) {
      const listener = this.listenerProcesses.get(hotkeyId);
      if (listener) {
        this.retireListener(hotkeyId, listener, { emitStopped: true, reason: "stopped" });
      } else {
        this.retryRetiringProcessTermination(hotkeyId);
      }
      return;
    }

    this.retryRetiringProcessTermination();
    for (const [id, listener] of [...this.listenerProcesses.entries()]) {
      this.retireListener(id, listener, { emitStopped: true, reason: "stopped" });
    }
  }

  async stopAndWait(hotkeyId = null, timeoutMs = 1_500) {
    this.stop(hotkeyId);
    const retiring = [...this.retiringProcesses.entries()].filter(
      ([, info]) => !hotkeyId || info.hotkeyId === hotkeyId
    );
    const waiters = retiring.map(([child]) => {
      if (!child || child.exitCode != null || child.signalCode != null) {
        this.clearRetiringProcessIfExited(child);
        return Promise.resolve(true);
      }

      return new Promise((resolve) => {
        let settled = false;
        const finish = (exited) => {
          if (settled) return;
          settled = true;
          this.clearTimeoutFn(timer);
          child.removeListener?.("exit", onExit);
          child.removeListener?.("error", onError);
          resolve(exited);
        };
        const onExit = () => finish(true);
        const onError = () => finish(child.exitCode != null || child.signalCode != null);
        const timer = this.setTimeoutFn(() => finish(false), timeoutMs);
        timer.unref?.();
        child.once?.("exit", onExit);
        child.once?.("error", onError);
      });
    });

    const results = await Promise.all(waiters);
    return results.every(Boolean);
  }

  hasRetiringProcess(hotkeyId = null) {
    return [...this.retiringProcesses.values()].some(
      (info) => !hotkeyId || info.hotkeyId === hotkeyId
    );
  }

  retryRetiringProcessTermination(hotkeyId = null) {
    for (const [child, info] of this.retiringProcesses.entries()) {
      if (hotkeyId && info.hotkeyId !== hotkeyId) continue;
      if (child.exitCode != null || child.signalCode != null) {
        this.clearRetiringProcessIfExited(child);
        continue;
      }
      try {
        child.kill();
      } catch {
        // A failed kill is not confirmation of exit; keep the process tracked.
      }
    }
  }

  clearRetiringProcessIfExited(child) {
    if (!child || (child.exitCode == null && child.signalCode == null)) return false;
    const retirement = this.retiringProcesses.get(child);
    if (!retirement) return false;
    this.retiringProcesses.delete(child);
    this.emit("retirement-confirmed", retirement);
    return true;
  }

  retireListener(hotkeyId, listener, { emitStopped = false, reason = "stopped" } = {}) {
    if (!listener) return;
    const child = listener.process;
    this.listenerProcesses.delete(hotkeyId);
    this.detachListenerOutput(listener);

    if (child && child.exitCode == null && child.signalCode == null) {
      this.retiringProcesses.set(child, {
        hotkeyId,
        key: listener.key,
        mode: listener.mode,
        reason,
      });
      debugLogger.debug("[WindowsKeyManager] Stopping key listener", { hotkeyId, reason });
      try {
        child.kill();
      } catch {
        // Keep it tracked until exit can be confirmed.
      }
    }

    if (emitStopped) {
      this.emit("route-stopped", {
        hotkeyId,
        key: listener.key,
        mode: listener.mode,
        reason,
      });
    }
  }

  clearReadyTimer(listener) {
    if (!listener?.readyTimer) return;
    this.clearTimeoutFn(listener.readyTimer);
    listener.readyTimer = null;
  }

  detachListenerOutput(listener) {
    this.clearReadyTimer(listener);
    listener?.protocolDecoder?.clear?.();
    if (listener) listener.protocolDecoder = null;
    if (listener?.stdoutHandler) {
      listener.process?.stdout?.removeListener?.("data", listener.stdoutHandler);
      listener.stdoutHandler = null;
    }
    if (listener?.stderrHandler) {
      listener.process?.stderr?.removeListener?.("data", listener.stderrHandler);
      listener.stderrHandler = null;
    }
  }

  /**
   * Check if the listener is available and ready
   */
  isAvailable() {
    return this.resolveListenerBinary() !== null;
  }

  /**
   * Report an error (only once per session to avoid log spam)
   */
  reportError(error, context = {}) {
    if (this.hasReportedError) {
      return;
    }
    this.hasReportedError = true;

    for (const [hotkeyId, listener] of [...this.listenerProcesses.entries()]) {
      this.retireListener(hotkeyId, listener, { reason: context.reason || "error" });
    }
    this.retryRetiringProcessTermination();

    debugLogger.warn("[WindowsKeyManager] Error occurred", { error: error.message });
    this.emit("error", error, context);
  }

  /**
   * Find the listener binary in various possible locations
   */
  resolveListenerBinary() {
    const binaryName = "windows-key-listener.exe";
    const candidates = new Set([
      path.join(__dirname, "..", "..", "resources", "bin", binaryName),
      path.join(__dirname, "..", "..", "resources", binaryName),
    ]);

    if (process.resourcesPath) {
      [
        path.join(process.resourcesPath, binaryName),
        path.join(process.resourcesPath, "bin", binaryName),
        path.join(process.resourcesPath, "resources", binaryName),
        path.join(process.resourcesPath, "resources", "bin", binaryName),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", binaryName),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", "bin", binaryName),
      ].forEach((candidate) => candidates.add(candidate));
    }

    const candidatePaths = [...candidates];

    for (const candidate of candidatePaths) {
      try {
        const stats = fs.statSync(candidate);
        if (stats.isFile()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}

module.exports = WindowsKeyManager;
