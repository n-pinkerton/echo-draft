const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const { restoreClipboardSnapshot, snapshotClipboardForRestore } = require("./clipboardTools");
const { runPowerShell } = require("./powershell");
const { assert, safeString, sleep } = require("./utils");

const { connectCdpTargets } = require("./checks/connectCdpTargets");
const { checkDictionaryUi } = require("./checks/dictionaryUi");
const { checkHistoryAndExports } = require("./checks/historyAndExports");
const { checkHotkeysRegistered } = require("./checks/hotkeys");
const { checkInsertionAndClipboard, closeInsertionTarget } = require("./checks/insertionAndClipboard");
const { checkPushToTalkRouting } = require("./checks/pushToTalk");
const { checkStageAndEchoGuards } = require("./checks/stageAndEcho");

async function runWindowsReleaseGate() {
  assert(process.platform === "win32", "windows_release_gate.js must be run on Windows.");

  const exePathArg = process.argv.slice(2).find((arg) => arg && !arg.startsWith("--"));
  const exePath = exePathArg
    ? path.resolve(exePathArg)
    : path.join(process.cwd(), "dist", "win-unpacked", "EchoDraft.exe");

  assert(fs.existsSync(exePath), `Packaged app not found: ${exePath}`);

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const port =
    Number(process.env.OPENWHISPR_E2E_CDP_PORT || "") ||
    9222 + Math.floor(Math.random() * 200);

  const env = {
    ...process.env,
    OPENWHISPR_E2E: "1",
    OPENWHISPR_E2E_RUN_ID: runId,
    OPENWHISPR_CHANNEL: process.env.OPENWHISPR_CHANNEL || "staging",
  };

  const originalClipboardSnapshot = await snapshotClipboardForRestore();

  console.log(`[gate] Launching: ${exePath}`);
  console.log(`[gate] CDP port: ${port}`);
  console.log(`[gate] OPENWHISPR_CHANNEL=${env.OPENWHISPR_CHANNEL} OPENWHISPR_E2E_RUN_ID=${runId}`);

  const appProc = spawn(exePath, [`--remote-debugging-port=${port}`], {
    env,
    stdio: "inherit",
  });

  let panel = null;
  let dictation = null;

  const cleanup = async () => {
    try {
      try {
        if (panel) {
          await panel.eval(`(async () => { try { await window.electronAPI?.appQuit?.(); } catch {} return true; })()`);
        } else if (dictation) {
          await dictation.eval(`(async () => { try { await window.electronAPI?.appQuit?.(); } catch {} return true; })()`);
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

      await Promise.race([
        new Promise((resolve) => appProc.once("exit", resolve)),
        sleep(7000),
      ]);

      if (appProc.exitCode !== null) {
        return;
      }

      try {
        appProc.kill();
      } catch {
        // ignore
      }

      await Promise.race([
        new Promise((resolve) => appProc.once("exit", resolve)),
        sleep(5000),
      ]);

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
    ({ panel, dictation } = await connectCdpTargets(port));

    await checkHotkeysRegistered(panel, record);
    await checkPushToTalkRouting(panel, record);
    await checkStageAndEchoGuards(dictation, record);

    const { notepad } = await checkInsertionAndClipboard(dictation, record, runId);

    const exportDir = path.join(process.env.TEMP || process.env.TMP || "C:\\\\Windows\\\\Temp", "openwhispr-e2e");
    await checkHistoryAndExports(panel, record, runId, exportDir);
    await checkDictionaryUi(panel, record, exportDir, runId);
    await closeInsertionTarget(notepad);

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.error("\n[gate] FAILURES:");
      for (const f of failed) {
        console.error(`- ${f.name}${f.details ? ` — ${f.details}` : ""}`);
      }
      process.exitCode = 1;
    } else {
      console.log("\n[gate] ALL CHECKS PASSED");
    }
  } finally {
    await cleanup();
  }

  process.exit(process.exitCode || 0);
}

module.exports = {
  runWindowsReleaseGate,
};
