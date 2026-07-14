const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const { app, BrowserWindow, clipboard, nativeImage } = require("electron");

const ClipboardManager = require("../../src/helpers/clipboard");
const {
  clipboardSnapshotsMatch,
  clipboardSnapshotShape,
  runWithIndependentCleanup,
  sameInsertionTargetIdentity,
} = require("./windowsSecurePasteCleanup.cjs");

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

const writeSmokeResult = (result) => {
  const resultPath = String(process.env.ECHODRAFT_WINDOWS_PASTE_SMOKE_RESULT || "");
  if (!resultPath) {
    return;
  }
  fs.writeFileSync(resultPath, JSON.stringify(result), {
    encoding: "utf8",
    flag: "wx",
  });
};

// The smoke window is intentionally destroyed before foreground verification.
// Keep Electron alive until every cleanup assertion has completed.
app.on("window-all-closed", () => {});

const readNativeHandle = (window) => {
  const handle = window.getNativeWindowHandle();
  const value = handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("The smoke-test window did not expose a valid native handle.");
  }
  return value;
};

const getProcessStartTicks = (processId) => {
  const command = `(Get-Process -Id ${Number(processId)} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", command],
    { encoding: "utf8", timeout: 5_000 }
  );
  const ticks = String(result.stdout || "").trim();
  if (result.status !== 0 || !/^\d{1,20}$/.test(ticks)) {
    throw new Error("The smoke test could not authenticate its target process.");
  }
  return ticks;
};

async function run() {
  if (process.platform !== "win32") {
    throw new Error("The secure Windows paste smoke test can run only on Windows.");
  }

  const manager = new ClipboardManager({
    platform: "win32",
    clipboard,
    nativeImage,
  });
  const originalClipboard = manager.snapshotClipboard();
  const previousForeground = await manager.captureInsertionTarget();
  let targetWindow = null;
  let distractorWindow = null;
  let insertedChars = 0;
  let insertedJobs = 0;
  let stackedInsertionsVerified = false;
  let foregroundRecoveryExercised = false;
  let clipboardMismatch = null;
  const destroySmokeWindows = () => {
    let allDestroyed = true;
    for (const window of [distractorWindow, targetWindow]) {
      try {
        if (window && !window.isDestroyed()) {
          window.destroy();
        }
      } catch {
        allDestroyed = false;
      }
    }
    return allDestroyed;
  };

  const execution = await runWithIndependentCleanup(
    async (signal) => {
      signal.throwIfAborted();
      if (!previousForeground?.success || !previousForeground.target) {
        const error = new Error("The smoke test could not capture the previous foreground app.");
        error.code = "WINDOWS_PASTE_SMOKE_FOREGROUND_CAPTURE_FAILED";
        throw error;
      }

      const tokens = [
        `EchoDraft stacked paste A ${Date.now()} `,
        `EchoDraft stacked paste B ${Date.now()}`,
      ];
      targetWindow = new BrowserWindow({
        width: 520,
        height: 180,
        show: false,
        title: "EchoDraft insertion smoke test",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const page = `<!doctype html><html><body style="font:16px sans-serif;padding:24px"><label for="target">Secure insertion smoke test</label><textarea id="target" autofocus style="display:block;width:440px;height:64px;margin-top:12px"></textarea></body></html>`;
      await targetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
      signal.throwIfAborted();
      targetWindow.show();
      targetWindow.focus();
      await targetWindow.webContents.executeJavaScript(
        "document.querySelector('#target').focus(); true"
      );
      await sleep(150);
      signal.throwIfAborted();

      const processStartTimeUtcTicks = getProcessStartTicks(process.pid);
      const insertionTarget = {
        hwnd: readNativeHandle(targetWindow),
        pid: process.pid,
        processStartTimeUtcTicks,
        capturedAt: Date.now(),
      };

      distractorWindow = new BrowserWindow({
        width: 420,
        height: 140,
        show: false,
        title: "EchoDraft insertion smoke distractor",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const distractorPage = `<!doctype html><html><body style="font:16px sans-serif;padding:24px"><label for="distractor">Foreground distractor</label><textarea id="distractor" autofocus style="display:block;width:340px;height:44px;margin-top:12px"></textarea></body></html>`;
      await distractorWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(distractorPage)}`
      );
      signal.throwIfAborted();
      distractorWindow.show();
      distractorWindow.focus();
      await distractorWindow.webContents.executeJavaScript(
        "document.querySelector('#distractor').focus(); true"
      );
      signal.throwIfAborted();

      const distractorTarget = {
        hwnd: readNativeHandle(distractorWindow),
        pid: process.pid,
        processStartTimeUtcTicks,
        capturedAt: Date.now(),
      };
      const distractorActivation = await manager.activateInsertionTarget(distractorTarget);
      signal.throwIfAborted();
      const foregroundBeforePaste = await manager.captureInsertionTarget();
      signal.throwIfAborted();
      if (
        distractorActivation?.success !== true ||
        foregroundBeforePaste?.success !== true ||
        !sameInsertionTargetIdentity(distractorTarget, foregroundBeforePaste.target) ||
        sameInsertionTargetIdentity(insertionTarget, foregroundBeforePaste.target)
      ) {
        const error = new Error(
          "The smoke test could not establish a distinct foreground window before insertion."
        );
        error.code = "WINDOWS_PASTE_SMOKE_DISTRACTOR_ACTIVATION_FAILED";
        throw error;
      }
      foregroundRecoveryExercised = true;

      signal.throwIfAborted();
      await Promise.all(tokens.map((token) => manager.pasteText(token, { insertionTarget })));
      await sleep(150);
      signal.throwIfAborted();
      const foregroundAfterPaste = await manager.captureInsertionTarget();
      signal.throwIfAborted();
      if (
        foregroundAfterPaste?.success !== true ||
        !sameInsertionTargetIdentity(insertionTarget, foregroundAfterPaste.target)
      ) {
        throw new Error("Secure paste did not reactivate the authenticated insertion target.");
      }
      const insertedText = await targetWindow.webContents.executeJavaScript(
        "document.querySelector('#target').value"
      );
      signal.throwIfAborted();
      const distractorText = await distractorWindow.webContents.executeJavaScript(
        "document.querySelector('#distractor').value"
      );
      signal.throwIfAborted();
      if (insertedText !== tokens.join("")) {
        throw new Error("The stacked secure paste calls did not insert both tokens in FIFO order.");
      }
      if (distractorText) {
        throw new Error("Secure paste inserted text into the foreground distractor.");
      }

      insertedChars = insertedText.length;
      insertedJobs = tokens.length;
      stackedInsertionsVerified = true;
    },
    {
      // Each cleanup action is isolated by runWithIndependentCleanup, so one
      // failure cannot prevent the remaining user-state restoration checks.
      restoreClipboard: () => {
        manager.restoreClipboardSnapshot(originalClipboard);
        return true;
      },
      destroyWindow: destroySmokeWindows,
      restoreForeground: async () => {
        if (!previousForeground?.success || !previousForeground.target) {
          return true;
        }
        const activation = await manager.activateInsertionTarget(previousForeground.target);
        return activation?.success === true;
      },
      verifyClipboard: () => {
        const restoredClipboard = manager.snapshotClipboard();
        const matches = clipboardSnapshotsMatch(originalClipboard, restoredClipboard);
        clipboardMismatch = matches
          ? null
          : {
              expected: clipboardSnapshotShape(originalClipboard),
              actual: clipboardSnapshotShape(restoredClipboard),
            };
        return matches;
      },
      verifyForeground: async () => {
        if (!previousForeground?.success || !previousForeground.target) {
          return true;
        }
        const currentForeground = await manager.captureInsertionTarget();
        return (
          currentForeground?.success === true &&
          sameInsertionTargetIdentity(previousForeground.target, currentForeground.target)
        );
      },
    },
    {
      cancelOperation: destroySmokeWindows,
    }
  );

  if (execution.operationError) {
    if (!execution.cleanup.success) {
      execution.operationError.cleanupFailures = execution.cleanup.failures;
    }
    throw execution.operationError;
  }
  if (!execution.cleanup.success) {
    const error = new Error("The smoke test could not restore and verify the user's state.");
    error.code = "WINDOWS_PASTE_SMOKE_CLEANUP_FAILED";
    error.cleanupFailures = execution.cleanup.failures;
    error.cleanupDiagnostics = clipboardMismatch ? { clipboardMismatch } : null;
    throw error;
  }

  return {
    success: true,
    foregroundRecoveryExercised,
    insertedChars,
    insertedJobs,
    stackedInsertionsVerified,
    userStateRestored: true,
  };
}

app.whenReady().then(async () => {
  try {
    const result = await run();
    writeSmokeResult(result);
    app.exit(0);
  } catch (error) {
    const failure = {
      success: false,
      errorCode: error?.code || "WINDOWS_PASTE_SMOKE_FAILED",
      message: error?.message || String(error),
      ...(Array.isArray(error?.cleanupFailures) ? { cleanupFailures: error.cleanupFailures } : {}),
      ...(error?.cleanupDiagnostics ? { cleanupDiagnostics: error.cleanupDiagnostics } : {}),
    };
    try {
      writeSmokeResult(failure);
    } catch {
      // The runner also treats a missing result file as a failed smoke test.
    }
    app.exit(1);
  }
});
