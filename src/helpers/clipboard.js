const { clipboard, nativeImage } = require("electron");
const { spawn, spawnSync } = require("child_process");
const { killProcess } = require("../utils/process");
const path = require("path");
const fs = require("fs");
const debugLogger = require("./debugLogger");

const CACHE_TTL_MS = 30000;

// macOS accessibility: once granted, permissions persist across app sessions,
// so use a long TTL. Denied results re-check quickly so granting takes effect fast.
const ACCESSIBILITY_GRANTED_TTL_MS = 24 * 60 * 60 * 1000;
const ACCESSIBILITY_DENIED_TTL_MS = 5000;

const getLinuxDesktopEnv = () =>
  [process.env.XDG_CURRENT_DESKTOP, process.env.XDG_SESSION_DESKTOP, process.env.DESKTOP_SESSION]
    .filter(Boolean)
    .join(":")
    .toLowerCase();

const isGnomeDesktop = (desktopEnv) => desktopEnv.includes("gnome");

const getLinuxSessionInfo = () => {
  const isWayland =
    (process.env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland" ||
    !!process.env.WAYLAND_DISPLAY;
  const xwaylandAvailable = isWayland && !!process.env.DISPLAY;
  const desktopEnv = getLinuxDesktopEnv();
  const isGnome = isWayland && isGnomeDesktop(desktopEnv);

  return { isWayland, xwaylandAvailable, desktopEnv, isGnome };
};

// ms before simulating keystroke
const PASTE_DELAYS = {
  darwin: 120,
  win32_nircmd: 30,
  win32_pwsh: 40,
  linux: 50,
};

// ms after paste completes before restoring clipboard
const RESTORE_DELAYS = {
  darwin: 450,
  win32_nircmd: 850,
  win32_pwsh: 850,
  linux: 200,
};

const isTruthyFlag = (value) => {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

function writeClipboardInRenderer(webContents, text) {
  if (!webContents || !webContents.executeJavaScript) {
    return Promise.reject(new Error("Invalid webContents for clipboard write"));
  }
  const escaped = JSON.stringify(text);
  return webContents.executeJavaScript(`navigator.clipboard.writeText(${escaped})`);
}

class ClipboardManager {
  constructor() {
    this.accessibilityCache = { value: null, expiresAt: 0 };
    this.commandAvailabilityCache = new Map();
    this.nircmdPath = null;
    this.nircmdChecked = false;
    this.fastPastePath = null;
    this.fastPasteChecked = false;
  }

  _isWayland() {
    if (process.platform !== "linux") return false;
    const { isWayland } = getLinuxSessionInfo();
    return isWayland;
  }

  _writeClipboardWayland(text, webContents) {
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
    if (this.nircmdChecked) {
      return this.nircmdPath;
    }

    this.nircmdChecked = true;

    if (process.platform !== "win32") {
      return null;
    }

    const possiblePaths = [
      path.join(process.resourcesPath, "bin", "nircmd.exe"),
      path.join(__dirname, "..", "..", "resources", "bin", "nircmd.exe"),
      path.join(process.cwd(), "resources", "bin", "nircmd.exe"),
    ];

    for (const nircmdPath of possiblePaths) {
      try {
        if (fs.existsSync(nircmdPath)) {
          this.safeLog(`✅ Found nircmd.exe at: ${nircmdPath}`);
          this.nircmdPath = nircmdPath;
          return nircmdPath;
        }
      } catch (error) {
        // Continue checking other paths
      }
    }

    this.safeLog("⚠️ nircmd.exe not found, will use PowerShell fallback");
    return null;
  }

  getNircmdStatus() {
    if (process.platform !== "win32") {
      return { available: false, reason: "Not Windows" };
    }
    const nircmdPath = this.getNircmdPath();
    return {
      available: !!nircmdPath,
      path: nircmdPath,
    };
  }

  resolveFastPasteBinary() {
    if (this.fastPasteChecked) {
      return this.fastPastePath;
    }
    this.fastPasteChecked = true;

    if (process.platform !== "darwin") {
      return null;
    }

    const candidates = new Set([
      path.join(__dirname, "..", "..", "resources", "bin", "macos-fast-paste"),
      path.join(__dirname, "..", "..", "resources", "macos-fast-paste"),
    ]);

    if (process.resourcesPath) {
      [
        path.join(process.resourcesPath, "macos-fast-paste"),
        path.join(process.resourcesPath, "bin", "macos-fast-paste"),
        path.join(process.resourcesPath, "resources", "macos-fast-paste"),
        path.join(process.resourcesPath, "resources", "bin", "macos-fast-paste"),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", "macos-fast-paste"),
        path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "resources",
          "bin",
          "macos-fast-paste"
        ),
      ].forEach((candidate) => candidates.add(candidate));
    }

    for (const candidate of candidates) {
      try {
        const stats = fs.statSync(candidate);
        if (stats.isFile()) {
          fs.accessSync(candidate, fs.constants.X_OK);
          this.fastPastePath = candidate;
          return candidate;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  safeLog(...args) {
    if (process.env.NODE_ENV === "development") {
      try {
        console.log(...args);
      } catch (error) {
        // Silently ignore EPIPE errors in logging
        if (error.code !== "EPIPE") {
          process.stderr.write(`Log error: ${error.message}\n`);
        }
      }
    }
  }

  shouldPreferNircmd() {
    return isTruthyFlag(
      process.env.OPENWHISPR_WINDOWS_USE_NIRCMD || process.env.OPENWHISPR_USE_NIRCMD
    );
  }

  snapshotClipboard() {
    const snapshot = {
      text: "",
      html: "",
      rtf: "",
      imagePng: null,
      formats: [],
    };

    try {
      snapshot.text = clipboard.readText();
    } catch {
      snapshot.text = "";
    }

    try {
      snapshot.html = clipboard.readHTML();
    } catch {
      snapshot.html = "";
    }

    try {
      snapshot.rtf = clipboard.readRTF();
    } catch {
      snapshot.rtf = "";
    }

    try {
      const image = clipboard.readImage();
      if (image && !image.isEmpty()) {
        snapshot.imagePng = image.toPNG();
      }
    } catch {
      snapshot.imagePng = null;
    }

    try {
      const formats = clipboard.availableFormats();
      for (const format of formats) {
        try {
          const buffer = clipboard.readBuffer(format);
          if (Buffer.isBuffer(buffer)) {
            snapshot.formats.push({ format, buffer: Buffer.from(buffer) });
          }
        } catch {
          // Ignore unreadable formats and preserve what we can.
        }
      }
    } catch {
      // Ignore format enumeration failures and fall back to plain text.
    }

    return snapshot;
  }

  restoreClipboardSnapshot(snapshot, webContents = null) {
    if (!snapshot) {
      return;
    }

    if (Buffer.isBuffer(snapshot.imagePng) && snapshot.imagePng.length > 0) {
      try {
        clipboard.clear();
        clipboard.writeImage(nativeImage.createFromBuffer(snapshot.imagePng));
        return;
      } catch (error) {
        this.safeLog("⚠️ Failed to restore clipboard image", {
          error: error?.message,
        });
      }
    }

    const data = {};
    if (typeof snapshot.text === "string" && snapshot.text.length > 0) {
      data.text = snapshot.text;
    }
    if (typeof snapshot.html === "string" && snapshot.html.length > 0) {
      data.html = snapshot.html;
    }
    if (typeof snapshot.rtf === "string" && snapshot.rtf.length > 0) {
      data.rtf = snapshot.rtf;
    }
    if (Buffer.isBuffer(snapshot.imagePng) && snapshot.imagePng.length > 0) {
      try {
        data.image = nativeImage.createFromBuffer(snapshot.imagePng);
      } catch {
        // Ignore invalid image data.
      }
    }

    const formatEntries = Array.isArray(snapshot.formats) ? snapshot.formats : [];
    let restoredSomething = false;

    if (Object.keys(data).length > 0) {
      try {
        clipboard.clear();
        clipboard.write(data);
        restoredSomething = true;
      } catch (error) {
        this.safeLog("⚠️ Failed to restore primary clipboard data", {
          error: error?.message,
        });
      }
    }

    if (formatEntries.length > 0) {
      if (!restoredSomething) {
        try {
          clipboard.clear();
        } catch {
          // ignore
        }
      }

      for (const entry of formatEntries) {
        if (!entry?.format || !Buffer.isBuffer(entry.buffer)) {
          continue;
        }
        try {
          clipboard.writeBuffer(entry.format, entry.buffer);
          restoredSomething = true;
        } catch {
          // Ignore format restore failures and preserve what we can.
        }
      }
    }

    if (!restoredSomething) {
      const textValue = typeof snapshot.text === "string" ? snapshot.text : "";
      if (process.platform === "linux" && this._isWayland()) {
        this._writeClipboardWayland(textValue, webContents);
      } else {
        clipboard.writeText(textValue);
      }
    }
  }

  scheduleClipboardRestore(snapshot, delayMs, webContents = null) {
    setTimeout(() => {
      this.restoreClipboardSnapshot(snapshot, webContents);
      this.safeLog("🔄 Clipboard restored", {
        delayMs,
        restoredFormats: snapshot?.formats?.length || 0,
      });
    }, delayMs);
  }

  runWindowsPowerShellScript(script, args = []) {
    return new Promise((resolve, reject) => {
      const wrappedScript = `& {\n${script}\n}`;
      const psArgs = [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        wrappedScript,
        ...args.map((arg) => String(arg)),
      ];

      const processHandle = spawn("powershell.exe", psArgs);
      let stdout = "";
      let stderr = "";

      processHandle.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      processHandle.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      processHandle.on("error", (error) => {
        reject(error);
      });

      processHandle.on("close", (code) => {
        resolve({
          code,
          stdout,
          stderr,
        });
      });
    });
  }

  parsePowerShellJsonOutput(stdout = "") {
    const trimmed = (stdout || "").trim();
    if (!trimmed) {
      return null;
    }
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim());
    const candidate = [...lines]
      .reverse()
      .find((line) => line.startsWith("{") || line.startsWith("["));
    if (!candidate) {
      return null;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  resolveTargetLabel(target = {}) {
    const processName = target?.processName ? String(target.processName) : "";
    const title = target?.title ? String(target.title) : "";
    if (processName && title) return `${processName} (${title})`;
    if (processName) return processName;
    if (title) return title;
    return "original app";
  }

  async captureInsertionTarget() {
    if (process.platform !== "win32") {
      return {
        success: false,
        reason: "unsupported_platform",
      };
    }

    const captureScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinApiCapture {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [WinApiCapture]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  [pscustomobject]@{ success = $false; reason = "no_foreground_window" } | ConvertTo-Json -Compress
  exit 0
}
$pid = 0
[void][WinApiCapture]::GetWindowThreadProcessId($hwnd, [ref]$pid)
$titleBuilder = New-Object System.Text.StringBuilder 512
[void][WinApiCapture]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity)
$processName = ""
try { $processName = (Get-Process -Id $pid -ErrorAction Stop).ProcessName } catch {}
[pscustomobject]@{
  success = $true
  hwnd = [Int64]$hwnd
  pid = [Int32]$pid
  processName = $processName
  title = $titleBuilder.ToString()
} | ConvertTo-Json -Compress
`.trim();

    try {
      const result = await this.runWindowsPowerShellScript(captureScript);
      const parsed = this.parsePowerShellJsonOutput(result.stdout);

      if (result.code !== 0) {
        return {
          success: false,
          reason: "capture_failed",
          error: (result.stderr || "").trim() || `PowerShell exited with code ${result.code}`,
        };
      }

      if (!parsed || parsed.success !== true || !parsed.hwnd) {
        return {
          success: false,
          reason: parsed?.reason || "capture_failed",
          error: (result.stderr || "").trim() || null,
        };
      }

      return {
        success: true,
        target: {
          hwnd: Number(parsed.hwnd),
          pid: Number(parsed.pid) || null,
          processName: parsed.processName || "",
          title: parsed.title || "",
          capturedAt: Date.now(),
        },
      };
    } catch (error) {
      return {
        success: false,
        reason: "capture_failed",
        error: error?.message || String(error),
      };
    }
  }

  async activateInsertionTarget(target) {
    if (process.platform !== "win32") {
      return {
        success: false,
        reason: "unsupported_platform",
      };
    }

    const hwnd = Number(target?.hwnd);
    if (!Number.isFinite(hwnd) || hwnd <= 0) {
      return {
        success: false,
        reason: "invalid_target",
      };
    }

    const activateScript = `
param([Int64]$TargetHwnd)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinApiActivate {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
"@
$target = [IntPtr]$TargetHwnd
if (-not [WinApiActivate]::IsWindow($target)) {
  [pscustomobject]@{ success = $false; reason = "window_not_found"; targetHwnd = $TargetHwnd } | ConvertTo-Json -Compress
  exit 0
}
[void][WinApiActivate]::ShowWindowAsync($target, 9)
$setResult = [WinApiActivate]::SetForegroundWindow($target)
Start-Sleep -Milliseconds 140
$active = [Int64][WinApiActivate]::GetForegroundWindow()
$success = ($active -eq $TargetHwnd)
if (-not $success -and $setResult) {
  Start-Sleep -Milliseconds 120
  $active = [Int64][WinApiActivate]::GetForegroundWindow()
  $success = ($active -eq $TargetHwnd)
}
[pscustomobject]@{
  success = $success
  reason = $(if ($success) { "" } else { "foreground_switch_blocked" })
  targetHwnd = $TargetHwnd
  activeHwnd = $active
  setForegroundReturned = [bool]$setResult
} | ConvertTo-Json -Compress
`.trim();

    try {
      const result = await this.runWindowsPowerShellScript(activateScript, [String(hwnd)]);
      const parsed = this.parsePowerShellJsonOutput(result.stdout);

      if (result.code !== 0) {
        return {
          success: false,
          reason: "activation_failed",
          error: (result.stderr || "").trim() || `PowerShell exited with code ${result.code}`,
        };
      }

      if (!parsed || parsed.success !== true) {
        return {
          success: false,
          reason: parsed?.reason || "activation_failed",
          details: parsed || null,
        };
      }

      return {
        success: true,
        details: parsed,
      };
    } catch (error) {
      return {
        success: false,
        reason: "activation_failed",
        error: error?.message || String(error),
      };
    }
  }

  commandExists(cmd) {
    const now = Date.now();
    const cached = this.commandAvailabilityCache.get(cmd);
    if (cached && now < cached.expiresAt) {
      return cached.exists;
    }
    try {
      const res = spawnSync("sh", ["-c", `command -v ${cmd}`], {
        stdio: "ignore",
      });
      const exists = res.status === 0;
      this.commandAvailabilityCache.set(cmd, {
        exists,
        expiresAt: now + CACHE_TTL_MS,
      });
      return exists;
    } catch {
      this.commandAvailabilityCache.set(cmd, {
        exists: false,
        expiresAt: now + CACHE_TTL_MS,
      });
      return false;
    }
  }

  async pasteText(text, options = {}) {
    const startTime = Date.now();
    const platform = process.platform;
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
        clipboard.writeText(text);
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
    const fastPasteBinary = this.resolveFastPasteBinary();
    const useFastPaste = !!fastPasteBinary;
    const pasteDelay = options.fromStreaming ? (useFastPaste ? 15 : 50) : PASTE_DELAYS.darwin;

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const pasteProcess = useFastPaste
          ? spawn(fastPasteBinary)
          : spawn("osascript", [
              "-e",
              'tell application "System Events" to keystroke "v" using command down',
            ]);

        let errorOutput = "";
        let hasTimedOut = false;

        pasteProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        pasteProcess.on("close", (code) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);
          pasteProcess.removeAllListeners();

          if (code === 0) {
            this.safeLog(`Text pasted successfully via ${useFastPaste ? "CGEvent" : "osascript"}`);
            this.scheduleClipboardRestore(originalClipboardSnapshot, RESTORE_DELAYS.darwin);
            resolve();
          } else if (useFastPaste) {
            this.safeLog(
              code === 2
                ? "CGEvent binary lacks accessibility trust, falling back to osascript"
                : `CGEvent paste failed (code ${code}), falling back to osascript`
            );
            this.fastPasteChecked = true;
            this.fastPastePath = null;
            this.pasteMacOSWithOsascript(originalClipboardSnapshot).then(resolve).catch(reject);
          } else {
            this.accessibilityCache = { value: null, expiresAt: 0 };
            const errorMsg = `Paste failed (code ${code}). Text is copied to clipboard - please paste manually with Cmd+V.`;
            reject(new Error(errorMsg));
          }
        });

        pasteProcess.on("error", (error) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);
          pasteProcess.removeAllListeners();

          if (useFastPaste) {
            this.safeLog("CGEvent paste error, falling back to osascript");
            this.fastPasteChecked = true;
            this.fastPastePath = null;
            this.pasteMacOSWithOsascript(originalClipboardSnapshot).then(resolve).catch(reject);
          } else {
            const errorMsg = `Paste command failed: ${error.message}. Text is copied to clipboard - please paste manually with Cmd+V.`;
            reject(new Error(errorMsg));
          }
        });

        const timeoutId = setTimeout(() => {
          hasTimedOut = true;
          killProcess(pasteProcess, "SIGKILL");
          pasteProcess.removeAllListeners();
          const errorMsg =
            "Paste operation timed out. Text is copied to clipboard - please paste manually with Cmd+V.";
          reject(new Error(errorMsg));
        }, 3000);
      }, pasteDelay);
    });
  }

  async pasteMacOSWithOsascript(originalClipboardSnapshot) {
    return new Promise((resolve, reject) => {
      const pasteProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to keystroke "v" using command down',
      ]);

      let hasTimedOut = false;

      pasteProcess.on("close", (code) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();

        if (code === 0) {
          this.safeLog("Text pasted successfully via osascript fallback");
          this.scheduleClipboardRestore(originalClipboardSnapshot, RESTORE_DELAYS.darwin);
          resolve();
        } else {
          this.accessibilityCache = { value: null, expiresAt: 0 };
          const errorMsg = `Paste failed (code ${code}). Text is copied to clipboard - please paste manually with Cmd+V.`;
          reject(new Error(errorMsg));
        }
      });

      pasteProcess.on("error", (error) => {
        if (hasTimedOut) return;
        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();
        const errorMsg = `Paste command failed: ${error.message}. Text is copied to clipboard - please paste manually with Cmd+V.`;
        reject(new Error(errorMsg));
      });

      const timeoutId = setTimeout(() => {
        hasTimedOut = true;
        killProcess(pasteProcess, "SIGKILL");
        pasteProcess.removeAllListeners();
        reject(
          new Error(
            "Paste operation timed out. Text is copied to clipboard - please paste manually with Cmd+V."
          )
        );
      }, 3000);
    });
  }

  async pasteWindows(originalClipboardSnapshot, options = {}) {
    const nircmdPath = this.getNircmdPath();
    const preferNircmd = this.shouldPreferNircmd();

    if (preferNircmd && nircmdPath) {
      try {
        return await this.pasteWithNircmd(nircmdPath, originalClipboardSnapshot, options);
      } catch (error) {
        this.safeLog("⚠️ Preferred nircmd paste failed, trying PowerShell fallback", {
          error: error?.message,
        });
        return this.pasteWithPowerShell(originalClipboardSnapshot, options);
      }
    }

    try {
      return await this.pasteWithPowerShell(originalClipboardSnapshot, options);
    } catch (error) {
      if (nircmdPath) {
        this.safeLog("⚠️ PowerShell paste failed, trying optional nircmd fallback", {
          error: error?.message,
        });
        return this.pasteWithNircmd(nircmdPath, originalClipboardSnapshot, options);
      }
      throw error;
    }
  }

  async pasteWithNircmd(nircmdPath, originalClipboardSnapshot, options = {}) {
    return new Promise((resolve, reject) => {
      const pasteDelay = PASTE_DELAYS.win32_nircmd;
      const restoreDelay = RESTORE_DELAYS.win32_nircmd;
      const webContents = options.webContents;

      setTimeout(() => {
        let hasTimedOut = false;
        const startTime = Date.now();

        this.safeLog(`⚡ nircmd paste starting (delay: ${pasteDelay}ms)`);

        const pasteProcess = spawn(nircmdPath, ["sendkeypress", "ctrl+v"]);

        let errorOutput = "";

        pasteProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        pasteProcess.on("close", (code) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);

          const elapsed = Date.now() - startTime;

          if (code === 0) {
            this.safeLog(`✅ nircmd paste success`, {
              elapsedMs: elapsed,
              restoreDelayMs: restoreDelay,
            });
            this.scheduleClipboardRestore(originalClipboardSnapshot, restoreDelay, webContents);
            resolve();
          } else {
            this.safeLog(`❌ nircmd paste failed`, {
              elapsedMs: elapsed,
              stderr: errorOutput,
              exitCode: code,
            });
            reject(
              new Error(
                `Windows paste failed with nircmd (code ${code}). Text is copied to clipboard - please paste manually with Ctrl+V.`
              )
            );
          }
        });

        pasteProcess.on("error", (error) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);
          const elapsed = Date.now() - startTime;
          this.safeLog(`❌ nircmd paste error`, {
            elapsedMs: elapsed,
            error: error.message,
          });
          reject(
            new Error(
              `Windows nircmd paste failed: ${error.message}. Text is copied to clipboard - please paste manually with Ctrl+V.`
            )
          );
        });

        const timeoutId = setTimeout(() => {
          hasTimedOut = true;
          const elapsed = Date.now() - startTime;
          this.safeLog(`⏱️ nircmd timeout`, { elapsedMs: elapsed });
          killProcess(pasteProcess, "SIGKILL");
          pasteProcess.removeAllListeners();
          reject(
            new Error(
              "Windows nircmd paste timed out. Text is copied to clipboard - please paste manually with Ctrl+V."
            )
          );
        }, 2000);
      }, pasteDelay);
    });
  }

  async pasteWithPowerShell(originalClipboardSnapshot, options = {}) {
    return new Promise((resolve, reject) => {
      const pasteDelay = PASTE_DELAYS.win32_pwsh;
      const restoreDelay = RESTORE_DELAYS.win32_pwsh;
      const webContents = options.webContents;

      setTimeout(() => {
        let hasTimedOut = false;
        const startTime = Date.now();

        this.safeLog(`🪟 PowerShell paste starting (delay: ${pasteDelay}ms)`);

        const pasteProcess = spawn("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');[System.Windows.Forms.SendKeys]::SendWait('^v')",
        ]);

        let errorOutput = "";

        pasteProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        pasteProcess.on("close", (code) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);

          const elapsed = Date.now() - startTime;

          if (code === 0) {
            this.safeLog(`✅ PowerShell paste success`, {
              elapsedMs: elapsed,
              restoreDelayMs: restoreDelay,
            });
            this.scheduleClipboardRestore(originalClipboardSnapshot, restoreDelay, webContents);
            resolve();
          } else {
            this.safeLog(`❌ PowerShell paste failed`, {
              code,
              elapsedMs: elapsed,
              stderr: errorOutput,
            });
            reject(
              new Error(
                `Windows paste failed with code ${code}. Text is copied to clipboard - please paste manually with Ctrl+V.`
              )
            );
          }
        });

        pasteProcess.on("error", (error) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);
          const elapsed = Date.now() - startTime;
          this.safeLog(`❌ PowerShell paste error`, {
            elapsedMs: elapsed,
            error: error.message,
          });
          reject(
            new Error(
              `Windows paste failed: ${error.message}. Text is copied to clipboard - please paste manually with Ctrl+V.`
            )
          );
        });

        const timeoutId = setTimeout(() => {
          hasTimedOut = true;
          const elapsed = Date.now() - startTime;
          this.safeLog(`⏱️ PowerShell paste timeout`, { elapsedMs: elapsed });
          killProcess(pasteProcess, "SIGKILL");
          pasteProcess.removeAllListeners();
          reject(
            new Error(
              "Paste operation timed out. Text is copied to clipboard - please paste manually with Ctrl+V."
            )
          );
        }, 5000);
      }, pasteDelay);
    });
  }

  async pasteLinux(originalClipboardSnapshot, options = {}) {
    const { isWayland, xwaylandAvailable, isGnome } = getLinuxSessionInfo();
    const webContents = options.webContents;
    const xdotoolExists = this.commandExists("xdotool");
    const wtypeExists = this.commandExists("wtype");
    const ydotoolExists = this.commandExists("ydotool");

    debugLogger.debug(
      "Linux paste environment",
      {
        isWayland,
        xwaylandAvailable,
        isGnome,
        xdotoolExists,
        wtypeExists,
        ydotoolExists,
        display: process.env.DISPLAY,
        waylandDisplay: process.env.WAYLAND_DISPLAY,
        xdgSessionType: process.env.XDG_SESSION_TYPE,
        xdgCurrentDesktop: process.env.XDG_CURRENT_DESKTOP,
      },
      "clipboard"
    );

    // Capture target window before our window takes focus
    const getXdotoolActiveWindow = () => {
      if (!xdotoolExists || (isWayland && !xwaylandAvailable)) {
        return null;
      }
      try {
        const result = spawnSync("xdotool", ["getactivewindow"]);
        if (result.status !== 0) {
          return null;
        }
        return result.stdout.toString().trim() || null;
      } catch {
        return null;
      }
    };

    const getXdotoolWindowClass = (windowId) => {
      if (!xdotoolExists || (isWayland && !xwaylandAvailable)) {
        return null;
      }
      try {
        const args = windowId
          ? ["getwindowclassname", windowId]
          : ["getactivewindow", "getwindowclassname"];
        const result = spawnSync("xdotool", args);
        if (result.status !== 0) {
          return null;
        }
        const className = result.stdout.toString().toLowerCase().trim();
        return className || null;
      } catch {
        return null;
      }
    };

    const targetWindowId = getXdotoolActiveWindow();
    const xdotoolWindowClass = getXdotoolWindowClass(targetWindowId);

    // Terminals use Ctrl+Shift+V instead of Ctrl+V
    const isTerminal = () => {
      const terminalClasses = [
        "konsole",
        "gnome-terminal",
        "terminal",
        "kitty",
        "alacritty",
        "terminator",
        "xterm",
        "urxvt",
        "rxvt",
        "tilix",
        "terminology",
        "wezterm",
        "foot",
        "st",
        "yakuake",
      ];

      if (xdotoolWindowClass) {
        const isTerminalWindow = terminalClasses.some((term) => xdotoolWindowClass.includes(term));
        if (isTerminalWindow) {
          this.safeLog(`🖥️ Terminal detected via xdotool: ${xdotoolWindowClass}`);
        }
        return isTerminalWindow;
      }

      try {
        if (this.commandExists("kdotool")) {
          const windowIdResult = spawnSync("kdotool", ["getactivewindow"]);
          if (windowIdResult.status === 0) {
            const windowId = windowIdResult.stdout.toString().trim();
            const classResult = spawnSync("kdotool", ["getwindowclassname", windowId]);
            if (classResult.status === 0) {
              const className = classResult.stdout.toString().toLowerCase().trim();
              const isTerminalWindow = terminalClasses.some((term) => className.includes(term));
              if (isTerminalWindow) {
                this.safeLog(`🖥️ Terminal detected via kdotool: ${className}`);
              }
              return isTerminalWindow;
            }
          }
        }
      } catch {
        // Detection failed, assume non-terminal
      }
      return false;
    };

    const inTerminal = isTerminal();
    const pasteKeys = inTerminal ? "ctrl+shift+v" : "ctrl+v";

    const canUseWtype = isWayland && !isGnome;
    const canUseYdotool = isWayland;
    const canUseXdotool = isWayland ? xwaylandAvailable && xdotoolExists : xdotoolExists;

    // windowactivate ensures the target window (not ours) receives the keystroke
    const xdotoolArgs = targetWindowId
      ? ["windowactivate", "--sync", targetWindowId, "key", pasteKeys]
      : ["key", pasteKeys];

    if (targetWindowId) {
      this.safeLog(
        `🎯 Targeting window ID ${targetWindowId} for paste (class: ${xdotoolWindowClass})`
      );
    }

    // ydotool key codes: 29=Ctrl, 42=Shift, 47=V; :1=press, :0=release
    const ydotoolArgs = inTerminal
      ? ["key", "29:1", "42:1", "47:1", "47:0", "42:0", "29:0"]
      : ["key", "29:1", "47:1", "47:0", "29:0"];

    const candidates = [
      ...(canUseWtype
        ? [
            inTerminal
              ? {
                  cmd: "wtype",
                  args: ["-M", "ctrl", "-M", "shift", "-k", "v", "-m", "shift", "-m", "ctrl"],
                }
              : { cmd: "wtype", args: ["-M", "ctrl", "-k", "v", "-m", "ctrl"] },
          ]
        : []),
      ...(canUseXdotool ? [{ cmd: "xdotool", args: xdotoolArgs }] : []),
      ...(canUseYdotool ? [{ cmd: "ydotool", args: ydotoolArgs }] : []),
    ];

    const available = candidates.filter((c) => this.commandExists(c.cmd));

    debugLogger.debug(
      "Available paste tools",
      {
        candidateTools: candidates.map((c) => c.cmd),
        availableTools: available.map((c) => c.cmd),
        targetWindowId,
        xdotoolWindowClass,
        inTerminal,
        pasteKeys,
      },
      "clipboard"
    );

    const pasteWith = (tool) =>
      new Promise((resolve, reject) => {
        const delay = isWayland ? 0 : PASTE_DELAYS.linux;

        setTimeout(() => {
          debugLogger.debug(
            "Attempting paste",
            {
              cmd: tool.cmd,
              args: tool.args,
              delay,
              isWayland,
            },
            "clipboard"
          );

          const proc = spawn(tool.cmd, tool.args);
          let stderr = "";
          let stdout = "";

          proc.stderr?.on("data", (data) => {
            stderr += data.toString();
          });

          proc.stdout?.on("data", (data) => {
            stdout += data.toString();
          });

          let timedOut = false;
          const timeoutId = setTimeout(() => {
            timedOut = true;
            killProcess(proc, "SIGKILL");
            debugLogger.warn(
              "Paste tool timed out",
              {
                cmd: tool.cmd,
                timeoutMs: 2000,
              },
              "clipboard"
            );
          }, 2000);

          proc.on("close", (code) => {
            if (timedOut) return reject(new Error(`Paste with ${tool.cmd} timed out`));
            clearTimeout(timeoutId);

            if (code === 0) {
              debugLogger.debug("Paste successful", { cmd: tool.cmd }, "clipboard");
              this.scheduleClipboardRestore(
                originalClipboardSnapshot,
                RESTORE_DELAYS.linux,
                webContents
              );
              resolve();
            } else {
              debugLogger.error(
                "Paste command failed",
                {
                  cmd: tool.cmd,
                  args: tool.args,
                  exitCode: code,
                  stderr: stderr.trim(),
                  stdout: stdout.trim(),
                },
                "clipboard"
              );
              reject(
                new Error(
                  `${tool.cmd} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`
                )
              );
            }
          });

          proc.on("error", (error) => {
            if (timedOut) return;
            clearTimeout(timeoutId);
            debugLogger.error(
              "Paste command spawn error",
              {
                cmd: tool.cmd,
                error: error.message,
                code: error.code,
              },
              "clipboard"
            );
            reject(error);
          });
        }, delay);
      });

    const failedAttempts = [];
    for (const tool of available) {
      try {
        await pasteWith(tool);
        this.safeLog(`✅ Paste successful using ${tool.cmd}`);
        debugLogger.info("Paste successful", { tool: tool.cmd }, "clipboard");
        return; // Success!
      } catch (error) {
        const failureInfo = {
          tool: tool.cmd,
          args: tool.args,
          error: error?.message || String(error),
        };
        failedAttempts.push(failureInfo);
        this.safeLog(`⚠️ Paste with ${tool.cmd} failed:`, error?.message || error);
        debugLogger.warn("Paste tool failed, trying next", failureInfo, "clipboard");
        // Continue to next tool
      }
    }

    debugLogger.error("All paste tools failed", { failedAttempts }, "clipboard");

    // xdotool type fallback for terminals where Ctrl+Shift+V simulation fails
    if (inTerminal && xdotoolExists && !isWayland) {
      debugLogger.debug(
        "Trying xdotool type fallback for terminal",
        {
          textLength: clipboard.readText().length,
          targetWindowId,
        },
        "clipboard"
      );
      this.safeLog("🔄 Trying xdotool type fallback for terminal...");
      const textToType = clipboard.readText(); // Read what we put in clipboard
      const typeArgs = targetWindowId
        ? ["windowactivate", "--sync", targetWindowId, "type", "--clearmodifiers", "--", textToType]
        : ["type", "--clearmodifiers", "--", textToType];

      try {
        await pasteWith({ cmd: "xdotool", args: typeArgs });
        this.safeLog("✅ Paste successful using xdotool type fallback");
        debugLogger.info("Terminal paste successful via xdotool type", {}, "clipboard");
        return;
      } catch (error) {
        const fallbackFailure = {
          tool: "xdotool type",
          args: typeArgs,
          error: error?.message || String(error),
        };
        failedAttempts.push(fallbackFailure);
        this.safeLog(`⚠️ xdotool type fallback failed:`, error?.message || error);
        debugLogger.warn("xdotool type fallback failed", fallbackFailure, "clipboard");
      }
    }

    const failureSummary =
      failedAttempts.length > 0
        ? `\n\nAttempted tools: ${failedAttempts.map((f) => `${f.tool} (${f.error})`).join(", ")}`
        : "";

    let errorMsg;
    if (isWayland) {
      if (isGnome) {
        if (!xwaylandAvailable) {
          errorMsg =
            "Clipboard copied, but GNOME Wayland blocks automatic pasting. Please paste manually with Ctrl+V.";
        } else if (!xdotoolExists) {
          errorMsg =
            "Clipboard copied, but automatic pasting on GNOME Wayland requires xdotool for XWayland apps. Please install xdotool or paste manually with Ctrl+V.";
        } else if (!xdotoolWindowClass) {
          errorMsg =
            "Clipboard copied, but the active app isn't running under XWayland. Please paste manually with Ctrl+V.";
        } else {
          errorMsg =
            "Clipboard copied, but paste simulation failed via XWayland. Please paste manually with Ctrl+V.";
        }
      } else if (!wtypeExists && !xdotoolExists) {
        if (!xwaylandAvailable) {
          errorMsg =
            "Clipboard copied, but automatic pasting on Wayland requires wtype or xdotool. Please install one or paste manually with Ctrl+V.";
        } else {
          errorMsg =
            "Clipboard copied, but automatic pasting on Wayland requires xdotool (recommended for Electron/XWayland apps) or wtype. Please install one or paste manually with Ctrl+V.";
        }
      } else {
        const xdotoolNote =
          xwaylandAvailable && !xdotoolExists
            ? " Consider installing xdotool, which works well with Electron apps running under XWayland."
            : "";
        errorMsg =
          "Clipboard copied, but paste simulation failed on Wayland. Your compositor may not support the virtual keyboard protocol." +
          xdotoolNote +
          " Alternatively, paste manually with Ctrl+V.";
      }
    } else {
      errorMsg =
        "Clipboard copied, but paste simulation failed on X11. Please install xdotool or paste manually with Ctrl+V.";
    }

    const err = new Error(errorMsg + failureSummary);
    err.code = "PASTE_SIMULATION_FAILED";
    err.failedAttempts = failedAttempts;
    debugLogger.error(
      "Throwing paste simulation failed error",
      {
        errorMsg,
        failedAttempts,
        isWayland,
        isGnome,
      },
      "clipboard"
    );
    throw err;
  }

  async checkAccessibilityPermissions() {
    if (process.platform !== "darwin") return true;

    const now = Date.now();
    if (now < this.accessibilityCache.expiresAt && this.accessibilityCache.value !== null) {
      return this.accessibilityCache.value;
    }

    return new Promise((resolve) => {
      const testProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to get name of first process',
      ]);

      let testOutput = "";
      let testError = "";

      testProcess.stdout.on("data", (data) => {
        testOutput += data.toString();
      });

      testProcess.stderr.on("data", (data) => {
        testError += data.toString();
      });

      testProcess.on("close", (code) => {
        const allowed = code === 0;
        this.accessibilityCache = {
          value: allowed,
          expiresAt:
            Date.now() + (allowed ? ACCESSIBILITY_GRANTED_TTL_MS : ACCESSIBILITY_DENIED_TTL_MS),
        };
        if (!allowed) {
          this.showAccessibilityDialog(testError);
        }
        resolve(allowed);
      });

      testProcess.on("error", (error) => {
        this.accessibilityCache = {
          value: false,
          expiresAt: Date.now() + ACCESSIBILITY_DENIED_TTL_MS,
        };
        resolve(false);
      });
    });
  }

  showAccessibilityDialog(testError) {
    const isStuckPermission =
      testError.includes("not allowed assistive access") ||
      testError.includes("(-1719)") ||
      testError.includes("(-25006)");

    let dialogMessage;
    if (isStuckPermission) {
      dialogMessage = `🔒 OpenWhispr needs Accessibility permissions, but it looks like you may have OLD PERMISSIONS from a previous version.

❗ COMMON ISSUE: If you've rebuilt/reinstalled OpenWhispr, the old permissions may be "stuck" and preventing new ones.

🔧 To fix this:
1. Open System Settings → Privacy & Security → Accessibility
2. Look for ANY old "OpenWhispr" entries and REMOVE them (click the - button)
3. Also remove any entries that say "Electron" or have unclear names
4. Click the + button and manually add the NEW OpenWhispr app
5. Make sure the checkbox is enabled
6. Restart OpenWhispr

⚠️ This is especially common during development when rebuilding the app.

📝 Without this permission, text will only copy to clipboard (no automatic pasting).

Would you like to open System Settings now?`;
    } else {
      dialogMessage = `🔒 OpenWhispr needs Accessibility permissions to paste text into other applications.

📋 Current status: Clipboard copy works, but pasting (Cmd+V simulation) fails.

🔧 To fix this:
1. Open System Settings (or System Preferences on older macOS)
2. Go to Privacy & Security → Accessibility
3. Click the lock icon and enter your password
4. Add OpenWhispr to the list and check the box
5. Restart OpenWhispr

⚠️ Without this permission, dictated text will only be copied to clipboard but won't paste automatically.

💡 In production builds, this permission is required for full functionality.

Would you like to open System Settings now?`;
    }

    const permissionDialog = spawn("osascript", [
      "-e",
      `display dialog "${dialogMessage}" buttons {"Cancel", "Open System Settings"} default button "Open System Settings"`,
    ]);

    permissionDialog.on("close", (dialogCode) => {
      if (dialogCode === 0) {
        this.openSystemSettings();
      }
    });

    permissionDialog.on("error", () => {});
  }

  openSystemSettings() {
    const settingsCommands = [
      ["open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]],
      ["open", ["-b", "com.apple.systempreferences"]],
      ["open", ["/System/Library/PreferencePanes/Security.prefPane"]],
    ];

    let commandIndex = 0;
    const tryNextCommand = () => {
      if (commandIndex < settingsCommands.length) {
        const [cmd, args] = settingsCommands[commandIndex];
        const settingsProcess = spawn(cmd, args);

        settingsProcess.on("error", (error) => {
          commandIndex++;
          tryNextCommand();
        });

        settingsProcess.on("close", (settingsCode) => {
          if (settingsCode !== 0) {
            commandIndex++;
            tryNextCommand();
          }
        });
      } else {
        spawn("open", ["-a", "System Preferences"]).on("error", () => {
          spawn("open", ["-a", "System Settings"]).on("error", () => {});
        });
      }
    };

    tryNextCommand();
  }

  preWarmAccessibility() {
    if (process.platform !== "darwin") return;
    this.checkAccessibilityPermissions().catch(() => {});
    this.resolveFastPasteBinary();
  }

  async readClipboard() {
    return clipboard.readText();
  }

  async writeClipboard(text, webContents = null) {
    if (process.platform === "linux" && this._isWayland()) {
      this._writeClipboardWayland(text, webContents);
    } else {
      clipboard.writeText(text);
    }
    return { success: true };
  }

  checkPasteTools() {
    const platform = process.platform;

    if (platform === "darwin") {
      const fastPaste = this.resolveFastPasteBinary();
      return {
        platform: "darwin",
        available: true,
        method: fastPaste ? "cgevent" : "applescript",
        requiresPermission: true,
        tools: [],
      };
    }

    if (platform === "win32") {
      return {
        platform: "win32",
        available: true,
        method: "powershell",
        requiresPermission: false,
        tools: [],
      };
    }

    const { isWayland, xwaylandAvailable, isGnome } = getLinuxSessionInfo();
    const tools = [];
    const canUseWtype = isWayland && !isGnome;
    const canUseYdotool = isWayland;
    const canUseXdotool = !isWayland || xwaylandAvailable;

    if (canUseWtype && this.commandExists("wtype")) {
      tools.push("wtype");
    }
    if (canUseXdotool && this.commandExists("xdotool")) {
      tools.push("xdotool");
    }
    if (canUseYdotool && this.commandExists("ydotool")) {
      tools.push("ydotool");
    }

    const available = tools.length > 0;
    let recommendedInstall;
    if (!available) {
      if (!isWayland) {
        recommendedInstall = "xdotool";
      } else if (isGnome) {
        recommendedInstall = xwaylandAvailable ? "xdotool" : undefined;
      } else {
        recommendedInstall = xwaylandAvailable ? "xdotool" : "wtype or xdotool";
      }
    }

    return {
      platform: "linux",
      available,
      method: available ? tools[0] : null,
      requiresPermission: false,
      isWayland,
      xwaylandAvailable,
      tools,
      recommendedInstall,
    };
  }
}

module.exports = ClipboardManager;
