#!/usr/bin/env node
/**
 * EchoDraft Windows packaged-runtime release gate.
 *
 * Runs a small suite of Windows-first checks against a PACKAGED build
 * using Chrome DevTools Protocol (CDP) + PowerShell helpers.
 *
 * Usage (Windows):
 *   node scripts\\gate\\windows_release_gate.js [path\\to\\EchoDraft.exe]
 *
 * Required env:
 *   OPENWHISPR_E2E=1 (enables guarded E2E helpers in preload + IPC)
 */

const { runWindowsReleaseGate } = require("./windowsReleaseGate/runWindowsReleaseGate");

runWindowsReleaseGate().catch((error) => {
  console.error(`[gate] ERROR: ${error.message}`);
  process.exit(1);
});

