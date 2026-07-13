const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { restoreClipboardSnapshot, snapshotClipboardForRestore } = require("./clipboardTools");
const { runPowerShell } = require("./powershell");
const { assert, isTruthyFlag, safeString, sleep } = require("./utils");

const { connectCdpTargets } = require("./checks/connectCdpTargets");
const { captureControlPanelUi } = require("./checks/captureUi");
const { getForegroundWindowInfo } = require("./foreground");
const { getFreeLoopbackPort } = require("./network");
const { checkDictionaryUi } = require("./checks/dictionaryUi");
const { checkHistoryAndExports } = require("./checks/historyAndExports");
const { checkHotkeysRegistered } = require("./checks/hotkeys");
const {
  checkInsertionAndClipboard,
  checkNonInteractiveDelivery,
  closeInsertionTarget,
} = require("./checks/insertionAndClipboard");
const { checkPushToTalkRouting } = require("./checks/pushToTalk");
const { checkSettingsUsability } = require("./checks/settingsUsability");
const { checkStageAndEchoGuards } = require("./checks/stageAndEcho");

function isForegroundAutomationAllowed(argv = [], env = {}) {
  return (
    argv.includes("--allow-foreground-automation") ||
    isTruthyFlag(env.OPENWHISPR_GATE_ALLOW_FOREGROUND_AUTOMATION)
  );
}

async function closeTargetWithRetry(
  target,
  { closeTarget = closeInsertionTarget, attempts = 2, delay = sleep } = {}
) {
  if (!target) {
    return true;
  }

  const maxAttempts = Math.max(1, Number(attempts) || 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (await closeTarget(target)) {
        return true;
      }
    } catch {
      // Retry below; the final boolean remains authoritative.
    }
    if (attempt < maxAttempts) {
      await delay(150);
    }
  }
  return false;
}

async function runWindowsReleaseGate() {
  assert(process.platform === "win32", "windows_release_gate.js must be run on Windows.");

  const exePathArg = process.argv.slice(2).find((arg) => arg && !arg.startsWith("--"));
  const allowForegroundAutomation = isForegroundAutomationAllowed(
    process.argv.slice(2),
    process.env
  );
  const exePath = exePathArg
    ? path.resolve(exePathArg)
    : path.join(process.cwd(), "dist", "win-unpacked", "EchoDraft.exe");

  assert(fs.existsSync(exePath), `Packaged app not found: ${exePath}`);

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const configuredPort = Number(process.env.OPENWHISPR_E2E_CDP_PORT || "");
  const port = configuredPort || (await getFreeLoopbackPort());

  const env = {
    ...process.env,
    OPENWHISPR_E2E: "1",
    OPENWHISPR_E2E_RUN_ID: runId,
    OPENWHISPR_E2E_SUPPRESS_WINDOW_FOCUS: allowForegroundAutomation ? "0" : "1",
    OPENWHISPR_CHANNEL: "staging",
  };

  const productionDbPath = path.join(env.APPDATA || "", "EchoDraft", "transcriptions.db");
  const fingerprintFile = (filePath) => {
    if (!fs.existsSync(filePath)) return null;
    const contents = fs.readFileSync(filePath);
    return {
      bytes: contents.length,
      sha256: crypto.createHash("sha256").update(contents).digest("hex").toUpperCase(),
    };
  };
  const productionDbBefore = fingerprintFile(productionDbPath);

  const originalClipboardSnapshot = await snapshotClipboardForRestore();

  console.log(`[gate] Launching: ${exePath}`);
  console.log(`[gate] CDP port: ${port}`);
  console.log(`[gate] OPENWHISPR_CHANNEL=${env.OPENWHISPR_CHANNEL} OPENWHISPR_E2E_RUN_ID=${runId}`);

  const foregroundBeforeSafeLaunch = allowForegroundAutomation
    ? null
    : await getForegroundWindowInfo();

  const appProc = spawn(exePath, [`--remote-debugging-port=${port}`], {
    env,
    stdio: "inherit",
  });

  let panel = null;
  let dictation = null;
  let insertionTarget = null;

  const cleanup = async () => {
    try {
      if (insertionTarget) {
        const target = insertionTarget;
        const closed = await closeTargetWithRetry(target);
        if (closed && insertionTarget === target) {
          insertionTarget = null;
        } else if (!closed) {
          process.exitCode = 1;
          console.error(
            `[gate] FAIL: Could not verify insertion target process ${target.pid} closed.`
          );
        }
      }

      try {
        if (panel) {
          await panel.eval(
            `(async () => { try { await window.electronAPI?.appQuit?.(); } catch {} return true; })()`
          );
        } else if (dictation) {
          await dictation.eval(
            `(async () => { try { await window.electronAPI?.appQuit?.(); } catch {} return true; })()`
          );
        }
      } catch {
        // ignore
      }

      await Promise.allSettled([panel?.close?.(), dictation?.close?.()]);
      panel = null;
      dictation = null;

      if (!appProc || appProc.exitCode !== null) {
        return;
      }

      await Promise.race([new Promise((resolve) => appProc.once("exit", resolve)), sleep(7000)]);

      if (appProc.exitCode !== null) {
        return;
      }

      try {
        appProc.kill();
      } catch {
        // ignore
      }

      await Promise.race([new Promise((resolve) => appProc.once("exit", resolve)), sleep(5000)]);

      if (appProc.exitCode === null) {
        await runPowerShell(
          `
param([Int32]$Pid)
try { Stop-Process -Id $Pid -Force -ErrorAction SilentlyContinue } catch {}
          `.trim(),
          [String(appProc.pid)],
          { timeoutMs: 10000 }
        );
      }
    } catch {
      // ignore
    } finally {
      if (originalClipboardSnapshot) {
        try {
          await restoreClipboardSnapshot(originalClipboardSnapshot);
        } catch {
          // ignore
        }
      }
    }
  };

  const results = [];
  const record = (name, ok, details = "") => {
    results.push({ name, ok: Boolean(ok), details: safeString(details) });
    console.log(`[gate] ${ok ? "PASS" : "FAIL"}: ${name}${details ? ` — ${details}` : ""}`);
  };

  try {
    const helperManifest = require("../../../resources/windows-key-listener.integrity.json");
    const packagedHelperPath = path.join(
      path.dirname(exePath),
      "resources",
      "bin",
      "windows-key-listener.exe"
    );
    assert(
      fs.existsSync(packagedHelperPath),
      `Packaged key listener not found: ${packagedHelperPath}`
    );
    const packagedHelperHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(packagedHelperPath))
      .digest("hex")
      .toUpperCase();
    assert(
      packagedHelperHash === helperManifest.binarySha256,
      `Packaged key listener hash mismatch: ${packagedHelperHash}`
    );
    record(
      "Packaged native key listener matches reviewed hash",
      true,
      `${helperManifest.version} ${packagedHelperHash}`
    );

    ({ panel, dictation } = await connectCdpTargets(port));

    if (foregroundBeforeSafeLaunch) {
      await sleep(250);
      const foregroundAfterSafeConnect = await getForegroundWindowInfo();
      const foregroundUnchanged =
        Number(foregroundAfterSafeConnect.hwnd) === Number(foregroundBeforeSafeLaunch.hwnd);
      record(
        "Safe gate launch and CDP connection leave the foreground window unchanged",
        foregroundUnchanged,
        `${foregroundBeforeSafeLaunch.processName} (${foregroundBeforeSafeLaunch.hwnd}) -> ${foregroundAfterSafeConnect.processName} (${foregroundAfterSafeConnect.hwnd})`
      );
      assert(
        foregroundUnchanged,
        "Safe gate changed the foreground window. No typing automation ran; inspect packaged window presentation before retrying."
      );
    }

    const profileStatus = await panel.eval(`
      (async () => await window.electronAPI.e2eGetHotkeyStatus())()
    `);
    const expectedUserDataPath = path.resolve(
      path.join(env.APPDATA || "", `EchoDraft-staging-e2e-${runId}`)
    );
    const actualUserDataPath = path.resolve(profileStatus?.userDataPath || "");
    assert(
      actualUserDataPath.toLowerCase() === expectedUserDataPath.toLowerCase(),
      `E2E profile isolation failed. Expected ${expectedUserDataPath}, received ${actualUserDataPath}`
    );
    record("Packaged gate uses a unique isolated profile", true, actualUserDataPath);

    await checkHotkeysRegistered(panel, record);
    await checkPushToTalkRouting(panel, record);
    await checkStageAndEchoGuards(dictation, record);

    if (allowForegroundAutomation) {
      console.warn(
        "[gate] Foreground automation explicitly enabled. Do not type or use the desktop until the gate finishes."
      );
      const { notepad } = await checkInsertionAndClipboard(dictation, record, runId, {
        onTargetStarted: (target) => {
          insertionTarget = target;
        },
        onTargetClosed: (target, closed) => {
          if (closed && insertionTarget === target) {
            insertionTarget = null;
          }
        },
      });
      insertionTarget = notepad;
    } else {
      console.log(
        "[gate] Safe mode: foreground, typing, and image-insertion checks are skipped. Use --allow-foreground-automation only on an idle test desktop."
      );
      record(
        "Safe gate mode avoids foreground and typing automation",
        true,
        "interactive insertion checks skipped by default"
      );
      await checkNonInteractiveDelivery(dictation, record, runId);
    }

    const exportDir = path.join(
      process.env.TEMP || process.env.TMP || "C:\\\\Windows\\\\Temp",
      "echodraft-e2e"
    );
    if (allowForegroundAutomation) {
      const screenshotPath = await captureControlPanelUi(panel, exportDir, runId);
      record(
        "Packaged control panel screenshot captured",
        fs.existsSync(screenshotPath),
        screenshotPath
      );
    } else {
      record(
        "Safe gate keeps the packaged control panel hidden",
        true,
        "visual screenshot capture is reserved for explicit foreground automation"
      );
    }
    await checkSettingsUsability(panel, record, exportDir, runId, {
      captureScreenshot: allowForegroundAutomation,
    });
    await checkHistoryAndExports(panel, record, runId, exportDir);
    await checkDictionaryUi(panel, record, exportDir, runId);
    const productionDbAfter = fingerprintFile(productionDbPath);
    record(
      "Packaged gate leaves the production transcription database byte-identical",
      JSON.stringify(productionDbAfter) === JSON.stringify(productionDbBefore),
      JSON.stringify({
        path: productionDbPath,
        before: productionDbBefore,
        after: productionDbAfter,
      })
    );
    if (insertionTarget) {
      const target = insertionTarget;
      const closed = await closeTargetWithRetry(target);
      record(
        "Interactive insertion target closes cleanly",
        closed,
        closed ? `verified PID ${target.pid} absent` : `could not verify PID ${target.pid} absent`
      );
      if (closed && insertionTarget === target) {
        insertionTarget = null;
      }
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error("\n[gate] FAILURES:");
      for (const f of failed) {
        console.error(`- ${f.name}${f.details ? ` — ${f.details}` : ""}`);
      }
      process.exitCode = 1;
    } else {
      console.log(
        allowForegroundAutomation
          ? "\n[gate] ALL CHECKS PASSED"
          : "\n[gate] ALL SAFE-MODE CHECKS PASSED (foreground insertion checks omitted)"
      );
    }
  } finally {
    await cleanup();
  }

  process.exit(process.exitCode || 0);
}

module.exports = {
  closeTargetWithRetry,
  isForegroundAutomationAllowed,
  runWindowsReleaseGate,
};
