const { PASTE_DELAYS, RESTORE_DELAYS } = require("../constants");

function getNircmdPath(manager) {
  if (manager.nircmdChecked) {
    return manager.nircmdPath;
  }

  manager.nircmdChecked = true;

  if (manager.deps.platform !== "win32") {
    return null;
  }

  const { path, fs, resourcesPath, helpersDir, cwd } = manager.deps;

  const possiblePaths = [
    typeof resourcesPath === "string" && resourcesPath
      ? path.join(resourcesPath, "bin", "nircmd.exe")
      : null,
    helpersDir ? path.join(helpersDir, "..", "..", "resources", "bin", "nircmd.exe") : null,
    cwd ? path.join(cwd, "resources", "bin", "nircmd.exe") : null,
  ].filter(Boolean);

  for (const candidate of possiblePaths) {
    try {
      if (fs.existsSync(candidate)) {
        manager.safeLog(`✅ Found nircmd.exe at: ${candidate}`);
        manager.nircmdPath = candidate;
        return candidate;
      }
    } catch {
      // Continue checking other paths
    }
  }

  manager.safeLog("⚠️ nircmd.exe not found, will use PowerShell fallback");
  return null;
}

function getNircmdStatus(manager) {
  if (manager.deps.platform !== "win32") {
    return { available: false, reason: "Not Windows" };
  }
  const nircmdPath = getNircmdPath(manager);
  return {
    available: Boolean(nircmdPath),
    path: nircmdPath,
  };
}

async function pasteWindows(manager, originalClipboardSnapshot, options = {}) {
  const nircmdPath = getNircmdPath(manager);
  const preferNircmd = manager.shouldPreferNircmd();

  if (preferNircmd && nircmdPath) {
    try {
      return await pasteWithNircmd(manager, nircmdPath, originalClipboardSnapshot, options);
    } catch (error) {
      manager.safeLog("⚠️ Preferred nircmd paste failed, trying PowerShell fallback", {
        error: error?.message,
      });
      return pasteWithPowerShell(manager, originalClipboardSnapshot, options);
    }
  }

  try {
    return await pasteWithPowerShell(manager, originalClipboardSnapshot, options);
  } catch (error) {
    if (nircmdPath) {
      manager.safeLog("⚠️ PowerShell paste failed, trying optional nircmd fallback", {
        error: error?.message,
      });
      return pasteWithNircmd(manager, nircmdPath, originalClipboardSnapshot, options);
    }
    throw error;
  }
}

async function pasteWithNircmd(manager, nircmdPath, originalClipboardSnapshot, options = {}) {
  const { spawn, killProcess } = manager.deps;

  return new Promise((resolve, reject) => {
    const pasteDelay = PASTE_DELAYS.win32_nircmd;
    const restoreDelay = RESTORE_DELAYS.win32_nircmd;
    const webContents = options.webContents;

    setTimeout(() => {
      let hasTimedOut = false;
      const startTime = Date.now();

      manager.safeLog(`⚡ nircmd paste starting (delay: ${pasteDelay}ms)`);

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
          manager.safeLog(`✅ nircmd paste success`, {
            elapsedMs: elapsed,
            restoreDelayMs: restoreDelay,
          });
          manager.scheduleClipboardRestore(originalClipboardSnapshot, restoreDelay, webContents);
          resolve();
        } else {
          manager.safeLog(`❌ nircmd paste failed`, {
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
        manager.safeLog(`❌ nircmd paste error`, {
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
        manager.safeLog(`⏱️ nircmd timeout`, { elapsedMs: elapsed });
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

async function pasteWithPowerShell(manager, originalClipboardSnapshot, options = {}) {
  const { spawn, killProcess } = manager.deps;

  return new Promise((resolve, reject) => {
    const pasteDelay = PASTE_DELAYS.win32_pwsh;
    const restoreDelay = RESTORE_DELAYS.win32_pwsh;
    const webContents = options.webContents;

    setTimeout(() => {
      let hasTimedOut = false;
      const startTime = Date.now();

      manager.safeLog(`🪟 PowerShell paste starting (delay: ${pasteDelay}ms)`);

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
          manager.safeLog(`✅ PowerShell paste success`, {
            elapsedMs: elapsed,
            restoreDelayMs: restoreDelay,
          });
          manager.scheduleClipboardRestore(originalClipboardSnapshot, restoreDelay, webContents);
          resolve();
        } else {
          manager.safeLog(`❌ PowerShell paste failed`, {
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
        manager.safeLog(`❌ PowerShell paste error`, {
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
        manager.safeLog(`⏱️ PowerShell paste timeout`, { elapsedMs: elapsed });
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

module.exports = {
  getNircmdPath,
  getNircmdStatus,
  pasteWindows,
  pasteWithNircmd,
  pasteWithPowerShell,
};

