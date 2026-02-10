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

class WindowsKeyManager extends EventEmitter {
  constructor() {
    super();
    this.listenerProcesses = new Map();
    this.isSupported = process.platform === "win32";
    this.hasReportedError = false;
    this.stoppingPids = new Set();
  }

  /**
   * Start listening for the specified key
   * @param {string} key - The key to listen for (e.g., "`", "F8", "F11", "CommandOrControl+F11")
   * @param {string} hotkeyId - Identifier for the hotkey route (e.g., "insert" | "clipboard")
   */
  start(key = "`", hotkeyId = "insert") {
    if (!this.isSupported) {
      return;
    }

    const existingListener = this.listenerProcesses.get(hotkeyId);
    if (existingListener && existingListener.key === key) {
      return;
    }

    // Stop existing listener for this route before starting a new one.
    this.stop(hotkeyId);

    const listenerPath = this.resolveListenerBinary();
    if (!listenerPath) {
      // Binary not found - this is OK, Push-to-Talk will use fallback mode
      this.emit("unavailable", new Error("Windows key listener binary not found"));
      return;
    }

    this.hasReportedError = false;

    debugLogger.debug("[WindowsKeyManager] Starting key listener", {
      hotkeyId,
      key,
      binaryPath: listenerPath,
    });

    let listenerProcess = null;
    try {
      listenerProcess = spawn(listenerPath, [key], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      debugLogger.error("[WindowsKeyManager] Failed to spawn process", { error: error.message });
      this.reportError(error);
      return;
    }

    this.listenerProcesses.set(hotkeyId, {
      process: listenerProcess,
      key,
      isReady: false,
    });

    listenerProcess.stdout.setEncoding("utf8");
    listenerProcess.stdout.on("data", (chunk) => {
      chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          if (line === "READY") {
            debugLogger.debug("[WindowsKeyManager] Listener ready", { hotkeyId, key });
            const listener = this.listenerProcesses.get(hotkeyId);
            if (listener) {
              listener.isReady = true;
            }
            this.emit("ready", { hotkeyId, key });
          } else if (line === "KEY_DOWN") {
            debugLogger.debug("[WindowsKeyManager] KEY_DOWN detected", { hotkeyId, key });
            this.emit("key-down", key, hotkeyId);
          } else if (line === "KEY_UP") {
            debugLogger.debug("[WindowsKeyManager] KEY_UP detected", { hotkeyId, key });
            this.emit("key-up", key, hotkeyId);
          } else {
            // Log unknown output at debug level (could be native binary's stderr info)
            debugLogger.debug("[WindowsKeyManager] Unknown output", { line });
          }
        });
    });

    listenerProcess.stderr.setEncoding("utf8");
    listenerProcess.stderr.on("data", (data) => {
      const message = data.toString().trim();
      if (message.length > 0) {
        // Native binary logs to stderr for info messages, don't treat as error
        debugLogger.debug("[WindowsKeyManager] Native stderr", { message });
      }
    });

    listenerProcess.on("error", (error) => {
      this.reportError(error);
      const currentListener = this.listenerProcesses.get(hotkeyId);
      if (currentListener?.process === listenerProcess) {
        this.listenerProcesses.delete(hotkeyId);
      }
    });

    listenerProcess.on("exit", (code, signal) => {
      const currentListener = this.listenerProcesses.get(hotkeyId);
      if (currentListener?.process === listenerProcess) {
        this.listenerProcesses.delete(hotkeyId);
      }

      const pid = listenerProcess.pid;
      if (pid && this.stoppingPids.has(pid)) {
        this.stoppingPids.delete(pid);
        return;
      }

      if (code !== 0) {
        const error = new Error(
          `Windows key listener "${hotkeyId}" exited with code ${code ?? "null"} signal ${signal ?? "null"}`
        );
        this.reportError(error);
      }
    });
  }

  /**
   * Stop the key listener
   */
  stop(hotkeyId = null) {
    if (hotkeyId) {
      const listener = this.listenerProcesses.get(hotkeyId);
      if (listener?.process) {
        debugLogger.debug("[WindowsKeyManager] Stopping key listener", { hotkeyId });
        if (listener.process.pid) {
          this.stoppingPids.add(listener.process.pid);
        }
        try {
          listener.process.kill();
        } catch {
          // Ignore kill errors
        }
      }
      this.listenerProcesses.delete(hotkeyId);
      return;
    }

    for (const [id, listener] of this.listenerProcesses.entries()) {
      if (listener?.process) {
        debugLogger.debug("[WindowsKeyManager] Stopping key listener", { hotkeyId: id });
        if (listener.process.pid) {
          this.stoppingPids.add(listener.process.pid);
        }
        try {
          listener.process.kill();
        } catch {
          // Ignore kill errors
        }
      }
    }
    this.listenerProcesses.clear();
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
  reportError(error) {
    if (this.hasReportedError) {
      return;
    }
    this.hasReportedError = true;

    for (const listener of this.listenerProcesses.values()) {
      try {
        listener?.process?.kill();
      } catch {
        // Ignore
      }
    }
    this.listenerProcesses.clear();

    debugLogger.warn("[WindowsKeyManager] Error occurred", { error: error.message });
    this.emit("error", error);
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
