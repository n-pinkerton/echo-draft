const fs = require("fs");
const path = require("path");

const getWhisperServerBinaryPath = ({
  platform = process.platform,
  arch = process.arch,
  resourcesPath = process.resourcesPath,
  baseDir = __dirname,
} = {}) => {
  const platformArch = `${platform}-${arch}`;
  const binaryName =
    platform === "win32"
      ? `whisper-server-${platformArch}.exe`
      : `whisper-server-${platformArch}`;
  const genericName = platform === "win32" ? "whisper-server.exe" : "whisper-server";

  const candidates = [];

  if (resourcesPath) {
    candidates.push(
      path.join(resourcesPath, "bin", binaryName),
      path.join(resourcesPath, "bin", genericName)
    );
  }

  // Dev / repo path (repoRoot/resources/bin)
  candidates.push(
    path.join(baseDir, "..", "..", "..", "resources", "bin", binaryName),
    path.join(baseDir, "..", "..", "..", "resources", "bin", genericName)
  );

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      fs.statSync(candidate);
      return candidate;
    } catch {
      // Can't access binary
    }
  }

  return null;
};

module.exports = { getWhisperServerBinaryPath };

