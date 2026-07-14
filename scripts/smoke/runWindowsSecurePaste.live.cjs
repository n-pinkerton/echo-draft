const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { isVerifiedSmokeResult } = require("./windowsSecurePasteCleanup.cjs");

if (process.platform !== "win32") {
  process.stderr.write("The secure Windows paste smoke test can run only on Windows.\n");
  process.exit(1);
}

const electronPath = require("electron");
const appPath = path.join(__dirname, "windowsSecurePaste.live.cjs");
const resultPath = path.join(
  os.tmpdir(),
  `echodraft-windows-paste-smoke-${process.pid}-${crypto.randomBytes(8).toString("hex")}.json`
);
const result = spawnSync(electronPath, [appPath], {
  cwd: path.join(__dirname, "..", ".."),
  encoding: "utf8",
  env: {
    ...process.env,
    ECHODRAFT_WINDOWS_PASTE_SMOKE_RESULT: resultPath,
  },
  // Last-resort bound only. It exceeds the complete budget for every bounded
  // PowerShell operation plus all five independently bounded cleanup steps.
  timeout: 90_000,
  windowsHide: true,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

let liveResult = null;
try {
  liveResult = JSON.parse(fs.readFileSync(resultPath, "utf8"));
} catch {
  liveResult = null;
} finally {
  try {
    fs.rmSync(resultPath, { force: true });
  } catch {
    // The unique temporary file contains no clipboard or dictated content.
  }
}

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}

if (result.status !== 0 || !isVerifiedSmokeResult(liveResult)) {
  if (liveResult) {
    process.stderr.write(`${JSON.stringify(liveResult)}\n`);
  }
  process.stderr.write("The live paste smoke test did not confirm user-state restoration.\n");
  process.exit(result.status || 1);
}

process.stdout.write(`${JSON.stringify(liveResult)}\n`);
process.stdout.write(`${JSON.stringify({ success: true, smoke: "windows-secure-paste" })}\n`);
