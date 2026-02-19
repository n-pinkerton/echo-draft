const { isTruthyFlag } = require("./utils/flags");
const { CACHE_TTL_MS } = require("./clipboard/constants");
const { getLinuxSessionInfo } = require("./clipboard/linuxSession");
const {
  restoreClipboardSnapshot,
  scheduleClipboardRestore,
  snapshotClipboard,
} = require("./clipboard/clipboardSnapshot");
const { runWindowsPowerShellScript, parsePowerShellJsonOutput } = require("./clipboard/windows/powershellUtils");
const {
  activateInsertionTarget,
  captureInsertionTarget,
  resolveTargetLabel,
} = require("./clipboard/windows/insertionTarget");
const { getNircmdPath, getNircmdStatus, pasteWindows, pasteWithNircmd, pasteWithPowerShell } = require("./clipboard/windows/windowsPaste");
const { resolveFastPasteBinary } = require("./clipboard/macos/fastPasteBinary");
const {
  checkAccessibilityPermissions,
  openSystemSettings,
  preWarmAccessibility,
  showAccessibilityDialog,
} = require("./clipboard/macos/macosAccessibility");
const { pasteMacOS, pasteMacOSWithOsascript } = require("./clipboard/macos/macosPaste");
const { pasteLinux } = require("./clipboard/linux/linuxPaste");
const { checkPasteTools } = require("./clipboard/pasteTools");

function writeClipboardInRenderer(webContents, text) {
  if (!webContents || !webContents.executeJavaScript) {
    return Promise.reject(new Error("Invalid webContents for clipboard write"));
  }
  const escaped = JSON.stringify(text);
  return webContents.executeJavaScript(`navigator.clipboard.writeText(${escaped})`);
}

function resolveClipboardDeps(overrides = {}) {
  const deps = overrides && typeof overrides === "object" ? overrides : {};
  const env = deps.env || process.env;
  const platform = deps.platform || process.platform;
  const now = deps.now || Date.now;

  const { clipboard, nativeImage } =
    deps.clipboard && deps.nativeImage ? { clipboard: deps.clipboard, nativeImage: deps.nativeImage } : require("electron");
  const childProcess = deps.spawn && deps.spawnSync ? null : require("child_process");
  const spawn = deps.spawn || childProcess.spawn;
  const spawnSync = deps.spawnSync || childProcess.spawnSync;

  const { killProcess } = deps.killProcess ? { killProcess: deps.killProcess } : require("../utils/process");

  return {
    env,
    platform,
    now,
    clipboard,
    nativeImage,
    spawn,
    spawnSync,
    killProcess,
    fs: deps.fs || require("fs"),
    path: deps.path || require("path"),
    debugLogger: deps.debugLogger || require("./debugLogger"),
    resourcesPath: deps.resourcesPath || process.resourcesPath,
    cwd: deps.cwd || process.cwd(),
    helpersDir: deps.helpersDir || __dirname,
    setTimeout: deps.setTimeout || setTimeout,
  };
}

class ClipboardManager {
  constructor(deps = {}) {
    this.deps = resolveClipboardDeps(deps);
    this.accessibilityCache = { value: null, expiresAt: 0 };
    this.commandAvailabilityCache = new Map();
    this.nircmdPath = null;
    this.nircmdChecked = false;
    this.fastPastePath = null;
    this.fastPasteChecked = false;
  }

  _isWayland() {
    if (this.deps.platform !== "linux") return false;
    const { isWayland } = getLinuxSessionInfo(this.deps.env);
    return isWayland;
  }

  _writeClipboardWayland(text, webContents) {
    const { spawnSync, clipboard } = this.deps;

    if (this.commandExists("wl-copy")) {
      try {
        const result = spawnSync("wl-copy", ["--", text], { timeout: 2000 });
        if (result.status === 0) {
          clipboard.writeText(text);
          return;
        }
      } catch {}
    }

    if (webContents && !webContents.isDestroyed()) {
      writeClipboardInRenderer(webContents, text).catch(() => {});
    }

    clipboard.writeText(text);
  }

  getNircmdPath() {
    return getNircmdPath(this);
  }

  getNircmdStatus() {
    return getNircmdStatus(this);
  }

  resolveFastPasteBinary() {
    return resolveFastPasteBinary(this);
  }

  safeLog(...args) {
    if (this.deps.env.NODE_ENV === "development") {
      try {
        // eslint-disable-next-line no-console
        console.log(...args);
      } catch (error) {
        // Silently ignore EPIPE errors in logging
        if (error?.code !== "EPIPE") {
          process.stderr.write(`Log error: ${error.message}\n`);
        }
      }
    }
  }

  shouldPreferNircmd() {
    return isTruthyFlag(
      this.deps.env.OPENWHISPR_WINDOWS_USE_NIRCMD || this.deps.env.OPENWHISPR_USE_NIRCMD
    );
  }

  snapshotClipboard() {
    return snapshotClipboard(this);
  }

  restoreClipboardSnapshot(snapshot, webContents = null) {
    restoreClipboardSnapshot(this, snapshot, webContents);
  }

  scheduleClipboardRestore(snapshot, delayMs, webContents = null) {
    scheduleClipboardRestore(this, snapshot, delayMs, webContents);
  }

  runWindowsPowerShellScript(script, args = []) {
    return runWindowsPowerShellScript(this, script, args);
  }

  parsePowerShellJsonOutput(stdout = "") {
    return parsePowerShellJsonOutput(stdout);
  }

  resolveTargetLabel(target = {}) {
    return resolveTargetLabel(target);
  }

  async captureInsertionTarget() {
    return await captureInsertionTarget(this);
  }

  async activateInsertionTarget(target) {
    return await activateInsertionTarget(this, target);
  }

  commandExists(cmd) {
    const now = this.deps.now();
    const cached = this.commandAvailabilityCache.get(cmd);
    if (cached && now < cached.expiresAt) {
      return cached.exists;
    }
    try {
      const res = this.deps.spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
      const exists = res.status === 0;
      this.commandAvailabilityCache.set(cmd, { exists, expiresAt: now + CACHE_TTL_MS });
      return exists;
    } catch {
      this.commandAvailabilityCache.set(cmd, { exists: false, expiresAt: now + CACHE_TTL_MS });
      return false;
    }
  }

  async pasteText(text, options = {}) {
    const startTime = Date.now();
    const platform = this.deps.platform;
    let method = "unknown";
    const webContents = options.webContents;

    try {
      const originalClipboardSnapshot = this.snapshotClipboard();
      this.safeLog("💾 Saved original clipboard snapshot", {
        formats: originalClipboardSnapshot.formats.length,
        textLength: (originalClipboardSnapshot.text || "").length,
      });

      if (platform === "linux" && this._isWayland()) {
        this._writeClipboardWayland(text, webContents);
      } else {
        this.deps.clipboard.writeText(text);
      }
      this.safeLog("📋 Text copied to clipboard:", text.substring(0, 50) + "...");

      if (platform === "darwin") {
        method = this.resolveFastPasteBinary() ? "cgevent" : "applescript";
        this.safeLog("🔍 Checking accessibility permissions for paste operation...");
        const hasPermissions = await this.checkAccessibilityPermissions();

        if (!hasPermissions) {
          this.safeLog("⚠️ No accessibility permissions - text copied to clipboard only");
          const errorMsg =
            "Accessibility permissions required for automatic pasting. Text has been copied to clipboard - please paste manually with Cmd+V.";
          throw new Error(errorMsg);
        }

        this.safeLog("✅ Permissions granted, attempting to paste...");
        await this.pasteMacOS(originalClipboardSnapshot, options);
      } else if (platform === "win32") {
        method = this.shouldPreferNircmd() && this.getNircmdPath() ? "nircmd" : "powershell";

        if (options?.insertionTarget?.hwnd) {
          const activationResult = await this.activateInsertionTarget(options.insertionTarget);
          if (!activationResult.success) {
            const targetLabel = this.resolveTargetLabel(options.insertionTarget);
            const reason = activationResult.reason || "focus switch blocked";
            throw new Error(
              `Could not return focus to ${targetLabel} (${reason}). Text is copied to clipboard - please paste manually with Ctrl+V.`
            );
          }
        }

        await this.pasteWindows(originalClipboardSnapshot, options);
      } else {
        method = "linux-tools";
        await this.pasteLinux(originalClipboardSnapshot, options);
      }

      this.safeLog("✅ Paste operation complete", {
        platform,
        method,
        elapsedMs: Date.now() - startTime,
        textLength: text.length,
      });
    } catch (error) {
      this.safeLog("❌ Paste operation failed", {
        platform,
        method,
        elapsedMs: Date.now() - startTime,
        error: error.message,
      });
      throw error;
    }
  }

  async pasteMacOS(originalClipboardSnapshot, options = {}) {
    return await pasteMacOS(this, originalClipboardSnapshot, options);
  }

  async pasteMacOSWithOsascript(originalClipboardSnapshot) {
    return await pasteMacOSWithOsascript(this, originalClipboardSnapshot);
  }

  async pasteWindows(originalClipboardSnapshot, options = {}) {
    return await pasteWindows(this, originalClipboardSnapshot, options);
  }

  async pasteWithNircmd(nircmdPath, originalClipboardSnapshot, options = {}) {
    return await pasteWithNircmd(this, nircmdPath, originalClipboardSnapshot, options);
  }

  async pasteWithPowerShell(originalClipboardSnapshot, options = {}) {
    return await pasteWithPowerShell(this, originalClipboardSnapshot, options);
  }

  async pasteLinux(originalClipboardSnapshot, options = {}) {
    return await pasteLinux(this, originalClipboardSnapshot, options);
  }

  async checkAccessibilityPermissions() {
    return await checkAccessibilityPermissions(this);
  }

  showAccessibilityDialog(testError) {
    showAccessibilityDialog(this, testError);
  }

  openSystemSettings() {
    openSystemSettings(this);
  }

  preWarmAccessibility() {
    preWarmAccessibility(this);
  }

  async readClipboard() {
    return this.deps.clipboard.readText();
  }

  async writeClipboard(text, webContents = null) {
    if (this.deps.platform === "linux" && this._isWayland()) {
      this._writeClipboardWayland(text, webContents);
    } else {
      this.deps.clipboard.writeText(text);
    }
    return { success: true };
  }

  checkPasteTools() {
    return checkPasteTools(this);
  }
}

module.exports = ClipboardManager;

