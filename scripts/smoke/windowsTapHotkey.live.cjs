#!/usr/bin/env node

const { execFile, spawn } = require("child_process");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const READY_TIMEOUT_MS = 3_000;
const TEST_VIRTUAL_KEY = 0x87; // F24: deliberately avoids the user's F9/F10 shortcuts.

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  if (process.platform !== "win32") {
    throw new Error("The Windows tap-hotkey smoke test can only run on Windows.");
  }

  const helperPath = path.resolve(
    __dirname,
    "..",
    "..",
    "resources",
    "bin",
    "windows-key-listener.exe"
  );
  const helper = spawn(helperPath, ["F24", "--tap"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const protocolLines = [];
  let stderr = "";
  let bufferedStdout = "";
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const readyTimer = setTimeout(
    () => readyReject(new Error("Timed out waiting for the Windows tap-hotkey helper.")),
    READY_TIMEOUT_MS
  );

  helper.stdout.setEncoding("utf8");
  helper.stderr.setEncoding("utf8");
  helper.stdout.on("data", (chunk) => {
    bufferedStdout += chunk;
    const lines = bufferedStdout.split(/\r?\n/);
    bufferedStdout = lines.pop() || "";
    for (const line of lines.map((value) => value.trim()).filter(Boolean)) {
      protocolLines.push(line);
      if (line === "READY") readyResolve();
    }
  });
  helper.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  helper.once("error", readyReject);
  helper.once("exit", (code) => {
    if (!protocolLines.includes("READY")) {
      readyReject(new Error(`Tap-hotkey helper exited before READY (code ${code}).`));
    }
  });

  try {
    await ready;
    clearTimeout(readyTimer);
    const keyScript = [
      "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class EchoDraftTapSmoke { [DllImport(\"user32.dll\")] public static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, System.UIntPtr extraInfo); }'",
      `for($i=0;$i -lt 8;$i++){[EchoDraftTapSmoke]::keybd_event(${TEST_VIRTUAL_KEY},0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 20}`,
      "Start-Sleep -Milliseconds 120",
      `[EchoDraftTapSmoke]::keybd_event(${TEST_VIRTUAL_KEY},0,2,[UIntPtr]::Zero)`,
    ].join("; ");
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", keyScript],
      { windowsHide: true, timeout: 5_000 }
    );
    await delay(250);

    const keyDownCount = protocolLines.filter((line) => line === "KEY_DOWN").length;
    if (!/Registered=1/.test(stderr)) {
      throw new Error(`Helper did not select RegisterHotKey mode: ${stderr.trim()}`);
    }
    if (keyDownCount !== 1) {
      throw new Error(`Expected one repeat-safe tap event, received ${keyDownCount}.`);
    }

    process.stdout.write(
      `${JSON.stringify({ success: true, route: "RegisterHotKey", repeatSafeEvents: keyDownCount })}\n`
    );
  } finally {
    clearTimeout(readyTimer);
    if (!helper.killed) helper.kill();
  }
}

run().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
