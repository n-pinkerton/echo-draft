const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEBUG_LOG_PATTERN = /^echodraft-debug-\d{4}-\d{2}-\d{2}\.jsonl$/i;
const DEBUG_AUDIO_PATTERN =
  /^echodraft-audio-[a-zA-Z0-9._-]+\.(?:json|m4a|mp3|mp4|ogg|opus|wav|webm)$/i;
const AUDIO_DIR_NAME = "audio";
const MAX_ROOT_ENTRIES = 10_000;
const MAX_AUDIO_ENTRIES = 1_000;

const isInsideRoot = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const describeError = (error) => error?.message || String(error);

const safeLstat = async (target, result, label) => {
  try {
    return await fs.promises.lstat(target);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      result.errors.push(`Could not inspect ${label}: ${describeError(error)}`);
    }
    return null;
  }
};

const sameIdentity = (first, second) =>
  Boolean(
    first &&
    second &&
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.isDirectory() === second.isDirectory()
  );

const verifyRootIdentity = async (root, expectedStat, result) => {
  const currentStat = await safeLstat(root, result, "the logs folder");
  if (
    !currentStat ||
    currentStat.isSymbolicLink() ||
    !currentStat.isDirectory() ||
    !sameIdentity(expectedStat, currentStat)
  ) {
    result.errors.push("The verified logs folder changed during cleanup; deletion stopped");
    return false;
  }
  return true;
};

const readDirectoryBounded = async (target, limit, result, label) => {
  const entries = [];
  let directory;
  try {
    directory = await fs.promises.opendir(target);
    for await (const entry of directory) {
      if (entries.length >= limit) {
        result.errors.push(`${label} contains more than ${limit} entries; deletion stopped`);
        return null;
      }
      entries.push(entry);
    }
    return entries;
  } catch (error) {
    result.errors.push(`Could not inspect ${label}: ${describeError(error)}`);
    return null;
  } finally {
    try {
      await directory?.close();
    } catch {
      // Async iteration normally closes the handle. A second close is harmless to ignore.
    }
  }
};

const purgeExpectedFile = async (root, rootStat, target, result) => {
  if (!isInsideRoot(root, target)) {
    result.errors.push("Refused a debug artifact outside the verified logs folder");
    return;
  }
  if (!(await verifyRootIdentity(root, rootStat, result))) return;

  const stat = await safeLstat(target, result, path.basename(target));
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isFile()) {
    result.preservedEntries += 1;
    result.errors.push(`Refused an unverified debug artifact named ${path.basename(target)}`);
    return;
  }

  try {
    await fs.promises.unlink(target);
    const residual = await safeLstat(target, result, path.basename(target));
    if (residual) {
      result.errors.push(`Could not verify deletion of ${path.basename(target)}`);
      return;
    }
    result.filesDeleted += 1;
    result.bytesDeleted += stat.size;
  } catch (error) {
    result.errors.push(`Could not delete ${path.basename(target)}: ${describeError(error)}`);
  }
};

const restoreQuarantinedAudioDirectory = async (audioDir, quarantineDir, result) => {
  const destinationStat = await safeLstat(audioDir, result, "the replacement audio folder");
  if (destinationStat) {
    result.errors.push("Could not restore preserved audio-folder entries safely");
    return false;
  }
  try {
    await fs.promises.rename(quarantineDir, audioDir);
    return true;
  } catch (error) {
    result.errors.push(`Could not restore preserved audio-folder entries: ${describeError(error)}`);
    return false;
  }
};

const purgeAudioDirectory = async (root, rootStat, audioDir, result) => {
  if (!isInsideRoot(root, audioDir)) {
    result.errors.push("Refused an audio folder outside the verified logs folder");
    return;
  }
  if (!(await verifyRootIdentity(root, rootStat, result))) return;

  const stat = await safeLstat(audioDir, result, "the captured audio folder");
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    result.preservedEntries += 1;
    result.errors.push("Refused to traverse an unverified or linked captured audio folder");
    return;
  }

  const quarantineDir = path.join(
    root,
    `.echodraft-purge-${process.pid}-${crypto.randomBytes(8).toString("hex")}`
  );
  result.quarantinePaths.push(quarantineDir);
  try {
    await fs.promises.rename(audioDir, quarantineDir);
  } catch (error) {
    result.errors.push(`Could not isolate captured audio for deletion: ${describeError(error)}`);
    return;
  }

  let quarantineRemoved = false;
  try {
    const movedStat = await safeLstat(quarantineDir, result, "the isolated audio folder");
    if (
      !sameIdentity(stat, movedStat) ||
      movedStat?.isSymbolicLink() ||
      !movedStat?.isDirectory()
    ) {
      result.errors.push("The captured audio folder changed while it was being isolated");
      return;
    }

    const entries = await readDirectoryBounded(
      quarantineDir,
      MAX_AUDIO_ENTRIES,
      result,
      "the captured audio folder"
    );
    if (!entries) return;

    for (const entry of entries) {
      if (!DEBUG_AUDIO_PATTERN.test(entry.name)) {
        result.preservedEntries += 1;
        continue;
      }
      await purgeExpectedFile(root, rootStat, path.join(quarantineDir, entry.name), result);
    }

    const remaining = await readDirectoryBounded(
      quarantineDir,
      MAX_AUDIO_ENTRIES,
      result,
      "the captured audio folder after cleanup"
    );
    if (!remaining) return;
    if (remaining.length === 0) {
      try {
        await fs.promises.rmdir(quarantineDir);
        quarantineRemoved = true;
        result.directoriesDeleted += 1;
      } catch (error) {
        result.errors.push(`Could not remove the empty audio folder: ${describeError(error)}`);
      }
    }
  } finally {
    if (!quarantineRemoved) {
      await restoreQuarantinedAudioDirectory(audioDir, quarantineDir, result);
    }
  }
};

const countExpectedAudioArtifacts = async (audioDir, result, label) => {
  const stat = await safeLstat(audioDir, result, label);
  if (!stat) return 0;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    result.errors.push(`Could not verify ${label} because it is linked or not a directory`);
    return 0;
  }
  const entries = await readDirectoryBounded(audioDir, MAX_AUDIO_ENTRIES, result, label);
  if (!entries) return 0;
  return entries.filter((entry) => DEBUG_AUDIO_PATTERN.test(entry.name)).length;
};

const countResidualArtifacts = async (root, rootStat, result) => {
  if (!(await verifyRootIdentity(root, rootStat, result))) return 0;
  const entries = await readDirectoryBounded(root, MAX_ROOT_ENTRIES, result, "the logs folder");
  if (!entries) return 0;

  let residuals = entries.filter((entry) => DEBUG_LOG_PATTERN.test(entry.name)).length;
  if (entries.some((entry) => entry.name === AUDIO_DIR_NAME)) {
    residuals += await countExpectedAudioArtifacts(
      path.join(root, AUDIO_DIR_NAME),
      result,
      "the captured audio folder"
    );
  }
  for (const quarantinePath of result.quarantinePaths) {
    if (path.dirname(quarantinePath) !== root) continue;
    residuals += await countExpectedAudioArtifacts(
      quarantinePath,
      result,
      "an isolated audio folder"
    );
  }
  return residuals;
};

const purgeDebugArtifactsAtRoot = async (logsDir) => {
  const root = path.resolve(String(logsDir || ""));
  const result = {
    root,
    filesDeleted: 0,
    directoriesDeleted: 0,
    bytesDeleted: 0,
    preservedEntries: 0,
    residualArtifacts: 0,
    quarantinePaths: [],
    errors: [],
  };

  if (!logsDir || !path.isAbsolute(logsDir)) {
    result.errors.push("The debug logs folder must be an absolute path");
    return { ...result, success: false };
  }

  const rootStat = await safeLstat(root, result, "the logs folder");
  if (!rootStat) {
    return { ...result, success: result.errors.length === 0 };
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    result.errors.push("Refused to purge an unverified or linked logs folder");
    return { ...result, success: false };
  }

  const entries = await readDirectoryBounded(root, MAX_ROOT_ENTRIES, result, "the logs folder");
  if (entries) {
    for (const entry of entries) {
      const target = path.join(root, entry.name);
      if (DEBUG_LOG_PATTERN.test(entry.name)) {
        await purgeExpectedFile(root, rootStat, target, result);
      } else if (entry.name === AUDIO_DIR_NAME) {
        await purgeAudioDirectory(root, rootStat, target, result);
      } else {
        result.preservedEntries += 1;
      }
    }
  }

  result.residualArtifacts = await countResidualArtifacts(root, rootStat, result);
  if (result.residualArtifacts > 0) {
    result.errors.push(
      `${result.residualArtifacts} diagnostic artifact${result.residualArtifacts === 1 ? " remains" : "s remain"}`
    );
  }

  return {
    ...result,
    quarantinePaths: undefined,
    success: result.errors.length === 0 && result.residualArtifacts === 0,
  };
};

module.exports = {
  AUDIO_DIR_NAME,
  DEBUG_AUDIO_PATTERN,
  DEBUG_LOG_PATTERN,
  MAX_AUDIO_ENTRIES,
  MAX_ROOT_ENTRIES,
  isInsideRoot,
  purgeDebugArtifactsAtRoot,
};
