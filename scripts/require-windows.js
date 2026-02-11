#!/usr/bin/env node

if (process.platform === "win32") {
  process.exit(0);
}

console.error("[build] Windows packaging must be run on Windows.");
console.error(
  "[build] Building \"--win\" from Linux/WSL will package Linux native binaries (e.g. better-sqlite3, ffmpeg), which causes the installed app to fail to launch on Windows."
);
console.error(
  "[build] Re-run the build from PowerShell/CMD on Windows (Node + npm installed), e.g. `npm ci` then `npm run build:win`."
);
process.exit(1);

