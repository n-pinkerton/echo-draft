const fs = require("fs");
const path = require("path");

const DEBUG_LOG_PATTERN = /^echodraft-debug-\d{4}-\d{2}-\d{2}\.jsonl$/i;
const DEBUG_AUDIO_PATTERN =
  /^echodraft-audio-[a-zA-Z0-9._-]+\.(?:json|m4a|mp3|mp4|ogg|opus|wav|webm)$/i;
const AUDIO_DIR_NAME = "audio";

const isInsideRoot = (root, candidate) => {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
};

const safeLstat = (target) => {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
};

const purgeExpectedFile = (root, target, result) => {
  if (!isInsideRoot(root, target)) {
    result.errors.push("Refused a debug artifact outside the verified logs folder");
    return;
  }

  const stat = safeLstat(target);
  if (!stat) {
    return;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    result.preservedEntries += 1;
    return;
  }

  try {
    fs.unlinkSync(target);
    result.filesDeleted += 1;
    result.bytesDeleted += stat.size;
  } catch (error) {
    result.errors.push(`Could not delete ${path.basename(target)}: ${error?.message || error}`);
  }
};

const purgeAudioDirectory = (root, audioDir, result) => {
  if (!isInsideRoot(root, audioDir)) {
    result.errors.push("Refused an audio folder outside the verified logs folder");
    return;
  }

  const stat = safeLstat(audioDir);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    result.preservedEntries += 1;
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(audioDir, { withFileTypes: true });
  } catch (error) {
    result.errors.push(`Could not inspect captured audio: ${error?.message || error}`);
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !DEBUG_AUDIO_PATTERN.test(entry.name)) {
      result.preservedEntries += 1;
      continue;
    }
    purgeExpectedFile(root, path.join(audioDir, entry.name), result);
  }

  try {
    if (fs.readdirSync(audioDir).length === 0) {
      fs.rmdirSync(audioDir);
      result.directoriesDeleted += 1;
    }
  } catch (error) {
    result.errors.push(`Could not remove the empty audio folder: ${error?.message || error}`);
  }
};

const purgeDebugArtifactsAtRoot = (logsDir) => {
  const root = path.resolve(String(logsDir || ""));
  const result = {
    root,
    filesDeleted: 0,
    directoriesDeleted: 0,
    bytesDeleted: 0,
    preservedEntries: 0,
    errors: [],
  };

  if (!logsDir || !path.isAbsolute(logsDir)) {
    result.errors.push("The debug logs folder must be an absolute path");
    return { ...result, success: false };
  }
  if (!fs.existsSync(root)) {
    return { ...result, success: true };
  }

  const rootStat = safeLstat(root);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    result.errors.push("Refused to purge an unverified or linked logs folder");
    return { ...result, success: false };
  }

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    result.errors.push(`Could not inspect the logs folder: ${error?.message || error}`);
    return { ...result, success: false };
  }

  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isFile() && DEBUG_LOG_PATTERN.test(entry.name)) {
      purgeExpectedFile(root, target, result);
    } else if (entry.name === AUDIO_DIR_NAME) {
      purgeAudioDirectory(root, target, result);
    } else {
      result.preservedEntries += 1;
    }
  }

  return { ...result, success: result.errors.length === 0 };
};

module.exports = {
  AUDIO_DIR_NAME,
  DEBUG_AUDIO_PATTERN,
  DEBUG_LOG_PATTERN,
  isInsideRoot,
  purgeDebugArtifactsAtRoot,
};
