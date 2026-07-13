#!/usr/bin/env node
/**
 * Compatibility entry point retained for older developer instructions.
 *
 * The reviewed Windows key listener is stored in the repository and verified by a pinned
 * source/binary manifest. Network acquisition is deliberately disabled so this command cannot
 * replace it with a mutable or unreviewed release asset.
 */

const { verifyRepositoryArtifacts } = require("./build-windows-key-listener");

function main() {
  if (process.platform !== "win32") {
    return;
  }
  const result = verifyRepositoryArtifacts();
  console.log(
    `[windows-key-listener] Repository-managed ${result.version} is already verified; no download is required.`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(
      `[windows-key-listener] Cannot acquire an unpinned replacement: ${error.message}`
    );
    process.exitCode = 1;
  }
}

module.exports = { main };
