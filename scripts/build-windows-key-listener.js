#!/usr/bin/env node
/**
 * Verifies the repository-managed Windows key listener before development or release builds.
 *
 * The executable is intentionally pinned by SHA-256 and bound to the reviewed C source. Builds
 * fail if either artifact is absent or changed; they never download a mutable "latest" asset.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(projectRoot, "resources", "windows-key-listener.c");
const binaryPath = path.join(projectRoot, "resources", "bin", "windows-key-listener.exe");
const manifestPath = path.join(projectRoot, "resources", "windows-key-listener.integrity.json");

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex").toUpperCase();
}

function verifyPinnedArtifacts({ manifest, sourceBuffer, binaryBuffer } = {}) {
  if (!manifest?.version || !manifest?.sourceSha256 || !manifest?.binarySha256) {
    throw new Error("Windows key listener integrity manifest is incomplete.");
  }
  if (!sourceBuffer) {
    throw new Error("Windows key listener source is missing.");
  }
  if (!binaryBuffer) {
    throw new Error("Pinned Windows key listener executable is missing.");
  }

  const sourceHash = sha256(sourceBuffer);
  const binaryHash = sha256(binaryBuffer);
  if (sourceHash !== String(manifest.sourceSha256).toUpperCase()) {
    throw new Error(
      `Windows key listener source hash mismatch: expected ${manifest.sourceSha256}, received ${sourceHash}.`
    );
  }
  if (binaryHash !== String(manifest.binarySha256).toUpperCase()) {
    throw new Error(
      `Windows key listener executable hash mismatch: expected ${manifest.binarySha256}, received ${binaryHash}.`
    );
  }

  return { version: manifest.version, sourceHash, binaryHash };
}

function verifyRepositoryArtifacts() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Integrity manifest not found: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return verifyPinnedArtifacts({
    manifest,
    sourceBuffer: fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath) : null,
    binaryBuffer: fs.existsSync(binaryPath) ? fs.readFileSync(binaryPath) : null,
  });
}

function main() {
  if (process.platform !== "win32") {
    return;
  }
  const result = verifyRepositoryArtifacts();
  console.log(
    `[windows-key-listener] Verified ${result.version} ` +
      `(binary SHA-256 ${result.binaryHash}, source SHA-256 ${result.sourceHash})`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[windows-key-listener] Release-blocking integrity failure: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  sha256,
  verifyPinnedArtifacts,
  verifyRepositoryArtifacts,
};
