const fs = require("fs");
const path = require("path");
const { deleteWindowsPathByHandle } = require("./windowsHandleDelete");

const DEBUG_LOG_PATTERN = /^echodraft-debug-\d{4}-\d{2}-\d{2}(?:-part-\d{3})?\.jsonl$/i;
const DEBUG_AUDIO_PATTERN =
  /^echodraft-audio-[a-zA-Z0-9._-]+\.(?:json|m4a|mp3|mp4|ogg|opus|wav|webm)$/i;
const QUARANTINE_DIR_PATTERN = /^\.echodraft-purge-\d{1,10}-[a-f0-9]{16}$/i;
const QUARANTINE_FILE_PATTERN = /^\.echodraft-purge-file-\d{1,10}-[a-f0-9]{16}$/i;
const AUDIO_DIR_NAME = "audio";
const MAX_ROOT_ENTRIES = 10_000;
const MAX_AUDIO_ENTRIES = 1_000;

const isInsideRoot = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const describeError = (error) => error?.message || String(error);
const toWindowsIdentity = (stat) => ({
  volumeSerialNumber: String(stat?.dev ?? ""),
  fileIndex: String(stat?.ino ?? ""),
});
const statSizeAsNumber = (stat) => {
  const size = typeof stat?.size === "bigint" ? stat.size : BigInt(stat?.size || 0);
  return size >= 0n && size <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(size) : 0;
};
const deleteVerifiedPathDefault = async (
  root,
  target,
  { expectDirectory = false, expectedRootIdentity = null, expectedTargetIdentity = null } = {}
) => {
  if (process.platform === "win32") {
    return await deleteWindowsPathByHandle(root, target, {
      expectDirectory,
      expectedRootIdentity,
      expectedTargetIdentity,
    });
  }
  const stat = await fs.promises.lstat(target, { bigint: true });
  if (stat.isSymbolicLink() || (expectDirectory ? !stat.isDirectory() : !stat.isFile())) {
    return { success: false, deleted: false, bytes: 0, error: "Candidate type changed" };
  }
  if (expectDirectory) await fs.promises.rmdir(target);
  else await fs.promises.unlink(target);
  return { success: true, deleted: true, bytes: expectDirectory ? 0 : statSizeAsNumber(stat) };
};

const safeLstat = async (target, result, label) => {
  try {
    return await fs.promises.lstat(target, { bigint: true });
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
    first.isDirectory() === second.isDirectory() &&
    first.isFile() === second.isFile()
  );

const verifyRootIdentity = async (root, expectedStat, rootHandle, result) => {
  let handleStat = null;
  try {
    handleStat = await rootHandle?.stat({ bigint: true });
  } catch (error) {
    result.errors.push(`Could not recheck the open logs folder: ${describeError(error)}`);
  }
  const currentStat = await safeLstat(root, result, "the logs folder");
  if (
    !handleStat ||
    !sameIdentity(expectedStat, handleStat) ||
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

const verifyDirectoryIdentity = async (directory, expectedStat, result, label) => {
  const currentStat = await safeLstat(directory, result, label);
  if (
    !currentStat ||
    currentStat.isSymbolicLink() ||
    !currentStat.isDirectory() ||
    !sameIdentity(expectedStat, currentStat)
  ) {
    result.errors.push(`${label} changed during cleanup; deletion stopped`);
    return false;
  }
  return true;
};

const verifyNoLinkedAncestors = async (root, result) => {
  let current = path.resolve(root);
  while (true) {
    const stat = await safeLstat(current, result, `path ancestor ${current}`);
    if (!stat) return false;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      result.errors.push(`Refused a logs path with a linked or invalid ancestor: ${current}`);
      return false;
    }
    const parent = path.dirname(current);
    if (parent === current) return true;
    current = parent;
  }
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

const isolateAndDeleteExpectedFile = async (
  root,
  rootStat,
  rootHandle,
  target,
  result,
  label = path.basename(target),
  deleteVerifiedPath = deleteVerifiedPathDefault
) => {
  if (!isInsideRoot(root, target)) {
    result.errors.push("Refused a debug artifact outside the verified logs folder");
    return;
  }
  if (!(await verifyRootIdentity(root, rootStat, rootHandle, result))) return;

  const parent = path.dirname(target);
  const parentStat = await safeLstat(parent, result, `the parent folder for ${label}`);
  if (!parentStat || parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    result.errors.push(`Refused an unverified parent folder for ${label}`);
    return;
  }

  const sourceStat = await safeLstat(target, result, label);
  if (!sourceStat) return;
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    result.preservedEntries += 1;
    result.errors.push(`Refused an unverified debug artifact named ${label}`);
    return;
  }

  try {
    const rootUnchanged = await verifyRootIdentity(root, rootStat, rootHandle, result);
    const parentUnchanged = await verifyDirectoryIdentity(
      parent,
      parentStat,
      result,
      `The parent folder for ${label}`
    );
    const pathStat = await safeLstat(target, result, label);
    if (
      !rootUnchanged ||
      !parentUnchanged ||
      !sameIdentity(sourceStat, pathStat) ||
      pathStat?.isSymbolicLink()
    ) {
      result.errors.push(`${label} changed before deletion; it was not deleted`);
      return;
    }

    const deletion = await deleteVerifiedPath(root, target, {
      expectDirectory: false,
      expectedRootIdentity: toWindowsIdentity(rootStat),
      expectedTargetIdentity: toWindowsIdentity(sourceStat),
    });
    if (!deletion?.success) {
      result.errors.push(`Could not delete ${label}: ${deletion?.error || "verification failed"}`);
      return;
    }
    const residual = await safeLstat(target, result, label);
    if (residual) {
      result.errors.push(`Could not verify deletion of ${label}`);
      return;
    }
    if (deletion.deleted !== false) {
      result.filesDeleted += 1;
      result.bytesDeleted += Number.isSafeInteger(deletion.bytes)
        ? deletion.bytes
        : statSizeAsNumber(sourceStat);
    }
  } catch (error) {
    result.errors.push(`Could not delete ${label}: ${describeError(error)}`);
  }
};

const removeVerifiedEmptyDirectory = async (
  root,
  rootStat,
  rootHandle,
  directory,
  directoryStat,
  result,
  label,
  deleteVerifiedPath = deleteVerifiedPathDefault
) => {
  if (!(await verifyRootIdentity(root, rootStat, rootHandle, result))) return false;
  if (!(await verifyDirectoryIdentity(directory, directoryStat, result, label))) return false;
  const remaining = await readDirectoryBounded(directory, MAX_AUDIO_ENTRIES, result, label);
  if (!remaining || remaining.length > 0) return false;
  try {
    const deletion = await deleteVerifiedPath(root, directory, {
      expectDirectory: true,
      expectedRootIdentity: toWindowsIdentity(rootStat),
      expectedTargetIdentity: toWindowsIdentity(directoryStat),
    });
    if (!deletion?.success) {
      result.errors.push(`Could not remove ${label}: ${deletion?.error || "verification failed"}`);
      return false;
    }
    const residual = await safeLstat(directory, result, label);
    if (residual) {
      result.errors.push(`Could not verify removal of ${label}`);
      return false;
    }
    result.directoriesDeleted += 1;
    return true;
  } catch (error) {
    result.errors.push(`Could not remove ${label}: ${describeError(error)}`);
    return false;
  }
};

const processAudioDirectoryContents = async (
  root,
  rootStat,
  rootHandle,
  directory,
  directoryStat,
  result,
  label,
  deleteVerifiedPath = deleteVerifiedPathDefault
) => {
  if (!(await verifyDirectoryIdentity(directory, directoryStat, result, label))) {
    return { removed: false };
  }
  const entries = await readDirectoryBounded(directory, MAX_AUDIO_ENTRIES, result, label);
  if (!entries) return { removed: false };

  for (const entry of entries) {
    if (DEBUG_AUDIO_PATTERN.test(entry.name) || QUARANTINE_FILE_PATTERN.test(entry.name)) {
      await isolateAndDeleteExpectedFile(
        root,
        rootStat,
        rootHandle,
        path.join(directory, entry.name),
        result,
        entry.name,
        deleteVerifiedPath
      );
    } else {
      result.preservedEntries += 1;
    }
  }

  const removed = await removeVerifiedEmptyDirectory(
    root,
    rootStat,
    rootHandle,
    directory,
    directoryStat,
    result,
    label,
    deleteVerifiedPath
  );
  return { removed };
};

const purgeAudioDirectory = async (
  root,
  rootStat,
  rootHandle,
  audioDir,
  result,
  deleteVerifiedPath = deleteVerifiedPathDefault
) => {
  if (!isInsideRoot(root, audioDir)) {
    result.errors.push("Refused an audio folder outside the verified logs folder");
    return;
  }
  if (!(await verifyRootIdentity(root, rootStat, rootHandle, result))) return;

  const sourceStat = await safeLstat(audioDir, result, "the captured audio folder");
  if (!sourceStat) return;
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    result.preservedEntries += 1;
    result.errors.push("Refused to traverse an unverified or linked captured audio folder");
    return;
  }

  await processAudioDirectoryContents(
    root,
    rootStat,
    rootHandle,
    audioDir,
    sourceStat,
    result,
    "the captured audio folder",
    deleteVerifiedPath
  );
};

const purgeStaleQuarantineDirectory = async (
  root,
  rootStat,
  rootHandle,
  quarantineDir,
  result,
  deleteVerifiedPath = deleteVerifiedPathDefault
) => {
  const stat = await safeLstat(quarantineDir, result, "a stale isolated audio folder");
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    result.preservedEntries += 1;
    result.errors.push("Refused an unverified stale diagnostic quarantine");
    return;
  }
  await processAudioDirectoryContents(
    root,
    rootStat,
    rootHandle,
    quarantineDir,
    stat,
    result,
    "a stale isolated audio folder",
    deleteVerifiedPath
  );
};

const countExpectedArtifactsInDirectory = async (directory, result, label) => {
  const stat = await safeLstat(directory, result, label);
  if (!stat) return 0;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    result.errors.push(`Could not verify ${label} because it is linked or not a directory`);
    return 1;
  }
  const entries = await readDirectoryBounded(directory, MAX_AUDIO_ENTRIES, result, label);
  if (!entries) return 1;
  return entries.filter(
    (entry) => DEBUG_AUDIO_PATTERN.test(entry.name) || QUARANTINE_FILE_PATTERN.test(entry.name)
  ).length;
};

const countResidualArtifacts = async (root, rootStat, rootHandle, result) => {
  if (!(await verifyRootIdentity(root, rootStat, rootHandle, result))) return 1;
  const entries = await readDirectoryBounded(root, MAX_ROOT_ENTRIES, result, "the logs folder");
  if (!entries) return 1;

  let residuals = entries.filter(
    (entry) => DEBUG_LOG_PATTERN.test(entry.name) || QUARANTINE_FILE_PATTERN.test(entry.name)
  ).length;
  for (const entry of entries) {
    if (entry.name === AUDIO_DIR_NAME) {
      residuals += await countExpectedArtifactsInDirectory(
        path.join(root, entry.name),
        result,
        "the captured audio folder"
      );
    } else if (QUARANTINE_DIR_PATTERN.test(entry.name)) {
      residuals += await countExpectedArtifactsInDirectory(
        path.join(root, entry.name),
        result,
        "a stale isolated audio folder"
      );
    }
  }
  return residuals;
};

const purgeDebugArtifactsAtRoot = async (
  logsDir,
  { deleteVerifiedPath = deleteVerifiedPathDefault } = {}
) => {
  const root = path.resolve(String(logsDir || ""));
  const result = {
    root,
    filesDeleted: 0,
    directoriesDeleted: 0,
    bytesDeleted: 0,
    preservedEntries: 0,
    residualArtifacts: 0,
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
  if (!(await verifyNoLinkedAncestors(root, result))) {
    return { ...result, success: false };
  }

  let rootHandle;
  try {
    rootHandle = await fs.promises.open(root, "r");
    const openedStat = await rootHandle.stat({ bigint: true });
    if (!sameIdentity(rootStat, openedStat)) {
      result.errors.push("The logs folder changed while it was being opened");
      return { ...result, success: false };
    }

    const entries = await readDirectoryBounded(root, MAX_ROOT_ENTRIES, result, "the logs folder");
    if (entries) {
      for (const entry of entries) {
        const target = path.join(root, entry.name);
        if (DEBUG_LOG_PATTERN.test(entry.name) || QUARANTINE_FILE_PATTERN.test(entry.name)) {
          await isolateAndDeleteExpectedFile(
            root,
            rootStat,
            rootHandle,
            target,
            result,
            entry.name,
            deleteVerifiedPath
          );
        } else if (entry.name === AUDIO_DIR_NAME) {
          await purgeAudioDirectory(root, rootStat, rootHandle, target, result, deleteVerifiedPath);
        } else if (QUARANTINE_DIR_PATTERN.test(entry.name)) {
          await purgeStaleQuarantineDirectory(
            root,
            rootStat,
            rootHandle,
            target,
            result,
            deleteVerifiedPath
          );
        } else {
          result.preservedEntries += 1;
        }
      }
    }

    result.residualArtifacts = await countResidualArtifacts(root, rootStat, rootHandle, result);
    if (result.residualArtifacts > 0) {
      result.errors.push(
        `${result.residualArtifacts} diagnostic artifact${result.residualArtifacts === 1 ? " remains" : "s remain"}`
      );
    }
  } catch (error) {
    result.errors.push(`Could not safely clean the logs folder: ${describeError(error)}`);
  } finally {
    try {
      await rootHandle?.close();
    } catch {
      // Cleanup result already reflects artifact state; handle-close errors are non-destructive.
    }
  }

  return {
    ...result,
    success: result.errors.length === 0 && result.residualArtifacts === 0,
  };
};

module.exports = {
  AUDIO_DIR_NAME,
  DEBUG_AUDIO_PATTERN,
  DEBUG_LOG_PATTERN,
  MAX_AUDIO_ENTRIES,
  MAX_ROOT_ENTRIES,
  QUARANTINE_DIR_PATTERN,
  QUARANTINE_FILE_PATTERN,
  deleteVerifiedPathDefault,
  isInsideRoot,
  purgeDebugArtifactsAtRoot,
};
