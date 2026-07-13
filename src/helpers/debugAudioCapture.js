const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { deleteWindowsPathByHandle } = require("./windowsHandleDelete");

const DEFAULT_MAX_CAPTURES = 10;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_DEBUG_AUDIO_BYTES = 64 * 1024 * 1024;
const AUDIO_SUBDIR = "audio";
const AUDIO_PREFIX = "echodraft-audio-";

const sameIdentity = (first, second) =>
  Boolean(first && second && first.dev === second.dev && first.ino === second.ino);

const toWindowsIdentity = (stat) => ({
  volumeSerialNumber: String(stat?.dev ?? ""),
  fileIndex: String(stat?.ino ?? ""),
});

const sameResolvedPath = (left, right) => {
  const normalize = (value) => {
    let resolved = path.resolve(value);
    if (process.platform === "win32") {
      if (resolved.toLowerCase().startsWith("\\\\?\\unc\\")) {
        resolved = `\\\\${resolved.slice(8)}`;
      } else if (resolved.startsWith("\\\\?\\")) {
        resolved = resolved.slice(4);
      }
      return resolved.toLowerCase();
    }
    return resolved;
  };
  return normalize(left) === normalize(right);
};

const resolvesToVerifiedIdentity = async (resolvedPath, expectedStat) => {
  const finalPath = await fs.promises.realpath(resolvedPath);
  if (sameResolvedPath(finalPath, resolvedPath)) return true;
  const finalStat = await fs.promises.lstat(finalPath, { bigint: true });
  return sameIdentity(finalStat, expectedStat);
};

const assertUnlinkedDirectory = async (directory, expectedStat = null) => {
  const resolved = path.resolve(directory);
  const stat = await fs.promises.lstat(resolved, { bigint: true });
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (expectedStat && !sameIdentity(stat, expectedStat))
  ) {
    throw new Error("Debug capture directory changed or is linked");
  }
  if (!(await resolvesToVerifiedIdentity(resolved, stat))) {
    throw new Error("Debug capture directory resolved outside its verified path");
  }
  return stat;
};

const assertOpenDirectoryIdentity = async (directory, expectedStat, directoryHandle) => {
  const pathStat = await assertUnlinkedDirectory(directory, expectedStat);
  const handleStat = await directoryHandle?.stat?.({ bigint: true });
  if (!sameIdentity(pathStat, handleStat)) {
    throw new Error("Debug capture directory handle no longer matches its verified path");
  }
  return pathStat;
};

const assertNoLinkedAncestors = async (directory) => {
  let current = path.resolve(directory);
  while (true) {
    await assertUnlinkedDirectory(current);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
};

const sanitizeToken = (value, fallback = "unknown") => {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  if (!raw) return fallback;
  const sanitized = raw.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || fallback;
};

const makeSafeTimestamp = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return sanitizeToken(String(Date.now()));
  }
  return date.toISOString().replace(/[:.]/g, "-");
};

const guessExtensionFromMimeType = (mimeType = "") => {
  const normalized = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("ogg") || normalized.includes("opus")) return "ogg";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "mp4";
  if (normalized.includes("wav")) return "wav";
  return "webm";
};

const getBinaryByteLength = (value) => {
  if (Buffer.isBuffer(value)) return value.length;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return -1;
};

const toBuffer = (value) => {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("audioBuffer must be binary data");
};

const deleteVerifiedRegularFile = async (
  root,
  filePath,
  {
    expectedRootStat,
    rootHandle,
    windowsRootIdentity,
    windowsTargetIdentity = null,
    expectedTargetStat = null,
  } = {}
) => {
  await assertOpenDirectoryIdentity(root, expectedRootStat, rootHandle);
  const beforeDelete = await statRegularFile(filePath);
  if (!beforeDelete) return false;
  if (expectedTargetStat && !sameIdentity(beforeDelete, expectedTargetStat)) return false;
  let deletionWasAccepted = false;
  if (process.platform === "win32") {
    const targetIdentity = windowsTargetIdentity || toWindowsIdentity(beforeDelete);
    const deletion = await deleteWindowsPathByHandle(root, filePath, {
      expectDirectory: false,
      expectedRootIdentity: windowsRootIdentity || toWindowsIdentity(expectedRootStat),
      expectedTargetIdentity: targetIdentity,
    });
    if (!deletion?.success) return false;
    deletionWasAccepted = Boolean(deletion.deleted);
  } else {
    const immediatelyBeforeDelete = await statRegularFile(filePath);
    if (!sameIdentity(beforeDelete, immediatelyBeforeDelete)) return false;
    await fs.promises.unlink(filePath);
  }
  await assertOpenDirectoryIdentity(root, expectedRootStat, rootHandle);
  return deletionWasAccepted || !(await statRegularFile(filePath));
};

const assertStagedPublication = async (publication) => {
  const {
    filePath,
    tempPath,
    tempHandle,
    openedStat,
    expectedParentStat,
    parentHandle,
  } = publication;
  await assertOpenDirectoryIdentity(path.dirname(filePath), expectedParentStat, parentHandle);
  const handleStat = await tempHandle.stat({ bigint: true });
  const tempStat = await fs.promises.lstat(tempPath, { bigint: true });
  const finalStat = await fs.promises.lstat(filePath, { bigint: true });
  if (
    !openedStat.isFile() ||
    tempStat.isSymbolicLink() ||
    !tempStat.isFile() ||
    finalStat.isSymbolicLink() ||
    !finalStat.isFile() ||
    !sameIdentity(openedStat, handleStat) ||
    !sameIdentity(openedStat, tempStat) ||
    !sameIdentity(openedStat, finalStat) ||
    !(await resolvesToVerifiedIdentity(tempPath, openedStat)) ||
    !(await resolvesToVerifiedIdentity(filePath, openedStat))
  ) {
    throw new Error("Debug capture output path changed during publication");
  }
  return finalStat;
};

const assertCommittedPublication = async (publication) => {
  const { filePath, tempHandle, openedStat, expectedParentStat, parentHandle } = publication;
  await assertOpenDirectoryIdentity(path.dirname(filePath), expectedParentStat, parentHandle);
  const handleStat = await tempHandle.stat({ bigint: true });
  const finalStat = await fs.promises.lstat(filePath, { bigint: true });
  if (
    !sameIdentity(openedStat, handleStat) ||
    !sameIdentity(openedStat, finalStat) ||
    finalStat.isSymbolicLink() ||
    !finalStat.isFile() ||
    !(await resolvesToVerifiedIdentity(filePath, openedStat))
  ) {
    throw new Error("Debug capture output changed while its pair was committed");
  }
  return finalStat;
};

const closePublicationHandles = async (publications) => {
  await Promise.all(
    publications.map(async (publication) => {
      const handle = publication.tempHandle;
      publication.tempHandle = null;
      await handle?.close().catch(() => {});
    })
  );
};

const deletePublicationLink = async (publication, candidate) => {
  if (!publication.openedStat) return false;
  return await deleteVerifiedRegularFile(path.dirname(publication.filePath), candidate, {
    expectedRootStat: publication.expectedParentStat,
    rootHandle: publication.parentHandle,
    windowsRootIdentity: publication.windowsParentIdentity,
    windowsTargetIdentity: toWindowsIdentity(publication.openedStat),
    expectedTargetStat: publication.openedStat,
  });
};

const rollbackPublications = async (publications) => {
  // Scrub every exact retained file first. Namespace cleanup is intentionally
  // second so a moved pair cannot preserve private bytes under an unknown name.
  await Promise.all(
    publications.map(async (publication) => {
      if (!publication.tempHandle) return;
      await publication.tempHandle.truncate(0).catch(() => {});
      await publication.tempHandle.sync().catch(() => {});
    })
  );
  await Promise.all(
    publications.flatMap((publication) => {
      const candidates = publication.published
        ? [publication.filePath, publication.tempPath]
        : [publication.tempPath];
      return candidates.map((candidate) =>
        deletePublicationLink(publication, candidate).catch(() => false)
      );
    })
  );
  await closePublicationHandles(publications);
};

const stageFilePublication = async (
  filePath,
  data,
  { expectedParentStat, parentHandle, windowsParentIdentity } = {}
) => {
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  const parent = path.dirname(filePath);
  const publication = {
    filePath,
    tempPath,
    tempHandle: null,
    openedStat: null,
    published: false,
    expectedParentStat,
    parentHandle,
    windowsParentIdentity,
  };
  try {
    await assertOpenDirectoryIdentity(parent, expectedParentStat, parentHandle);
    publication.tempHandle = await fs.promises.open(tempPath, "wx", 0o600);
    publication.openedStat = await publication.tempHandle.stat({ bigint: true });
    // A parent swap during open must be detected before any private byte is written.
    await assertOpenDirectoryIdentity(parent, expectedParentStat, parentHandle);
    const pathStat = await fs.promises.lstat(tempPath, { bigint: true });
    if (
      !publication.openedStat.isFile() ||
      pathStat.isSymbolicLink() ||
      !pathStat.isFile() ||
      !sameIdentity(publication.openedStat, pathStat) ||
      !(await resolvesToVerifiedIdentity(tempPath, publication.openedStat))
    ) {
      throw new Error("Debug capture temporary output changed while it was opened");
    }
    await assertOpenDirectoryIdentity(parent, expectedParentStat, parentHandle);
    await publication.tempHandle.writeFile(data);
    await publication.tempHandle.sync();
    await assertOpenDirectoryIdentity(parent, expectedParentStat, parentHandle);

    const tempBeforePublication = await fs.promises.lstat(tempPath, { bigint: true });
    const handleBeforePublication = await publication.tempHandle.stat({ bigint: true });
    if (
      tempBeforePublication.isSymbolicLink() ||
      !tempBeforePublication.isFile() ||
      !sameIdentity(publication.openedStat, tempBeforePublication) ||
      !sameIdentity(publication.openedStat, handleBeforePublication) ||
      !(await resolvesToVerifiedIdentity(tempPath, publication.openedStat))
    ) {
      throw new Error("Debug capture temporary output changed before publication");
    }

    // Publishing by hard link keeps the verified temporary handle open through the
    // namespace operation. A pathname replacement can therefore never be mistaken
    // for this run's output during the final identity checks.
    await fs.promises.link(tempPath, filePath);
    publication.published = true;
    await assertStagedPublication(publication);
    return publication;
  } catch (error) {
    await rollbackPublications([publication]);
    throw error;
  }
};

const commitPublicationPair = async (publications) => {
  try {
    await Promise.all(publications.map((publication) => assertStagedPublication(publication)));
    const tempDeleted = await Promise.all(
      publications.map((publication) =>
        deletePublicationLink(publication, publication.tempPath).catch(() => false)
      )
    );
    if (tempDeleted.some((deleted) => !deleted)) {
      throw new Error("Debug capture temporary publication could not be removed safely");
    }
    const finalStats = await Promise.all(
      publications.map((publication) => assertCommittedPublication(publication))
    );
    return finalStats;
  } catch (error) {
    await rollbackPublications(publications);
    throw error;
  }
};

const statRegularFile = async (filePath) => {
  try {
    const stat = await fs.promises.lstat(filePath, { bigint: true });
    return stat.isFile() && !stat.isSymbolicLink() ? stat : null;
  } catch {
    return null;
  }
};

const listCaptureFiles = async (audioDir, context = {}) => {
  if (context.expectedRootStat && context.rootHandle) {
    await assertOpenDirectoryIdentity(audioDir, context.expectedRootStat, context.rootHandle);
  }
  let entries = [];
  try {
    entries = await fs.promises.readdir(audioDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(AUDIO_PREFIX) || entry.name.endsWith(".json")) {
      continue;
    }
    const fullPath = path.join(audioDir, entry.name);
    // eslint-disable-next-line no-await-in-loop
    const stat = await statRegularFile(fullPath);
    if (!stat) continue;
    const parsed = path.parse(fullPath);
    const metaPath = path.join(parsed.dir, `${parsed.name}.json`);
    // eslint-disable-next-line no-await-in-loop
    const metaStat = await statRegularFile(metaPath);
    results.push({
      fileName: entry.name,
      fullPath,
      metaPath,
      mtimeMs: Number(stat.mtimeMs),
      bytes: Number(stat.size) + Number(metaStat?.size || 0),
      audioStat: stat,
      metaStat,
    });
  }
  return results;
};

const deleteCapturePair = async (entry, context = {}) => {
  const outcomes = await Promise.all(
    [
      { candidate: entry.fullPath, expectedTargetStat: entry.audioStat },
      { candidate: entry.metaPath, expectedTargetStat: entry.metaStat },
    ].map(async ({ candidate, expectedTargetStat }) => {
      if (!expectedTargetStat) return 0;
      const stat = await statRegularFile(candidate);
      if (!stat || !sameIdentity(stat, expectedTargetStat)) return 0;
      const deleted = await deleteVerifiedRegularFile(context.root, candidate, {
        ...context,
        expectedTargetStat,
        windowsTargetIdentity: toWindowsIdentity(expectedTargetStat),
      }).catch(() => false);
      return deleted ? Number(stat.size) : 0;
    })
  );
  return outcomes.reduce((sum, bytes) => sum + bytes, 0);
};

const enforceRetention = async (
  audioDir,
  maxCaptures = DEFAULT_MAX_CAPTURES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  context = {}
) => {
  const captures = (await listCaptureFiles(audioDir, context)).sort(
    (a, b) => b.mtimeMs - a.mtimeMs
  );
  const maxCount =
    Number.isInteger(maxCaptures) && maxCaptures > 0 ? maxCaptures : DEFAULT_MAX_CAPTURES;
  const maxBytes =
    Number.isSafeInteger(maxTotalBytes) && maxTotalBytes > 0
      ? maxTotalBytes
      : DEFAULT_MAX_TOTAL_BYTES;
  let totalBytes = captures.reduce((sum, entry) => sum + entry.bytes, 0);
  let kept = captures.length;
  let deleted = 0;
  let bytesDeleted = 0;

  for (let index = captures.length - 1; index >= 0; index -= 1) {
    if (kept <= maxCount && totalBytes <= maxBytes) break;
    const entry = captures[index];
    // eslint-disable-next-line no-await-in-loop
    const removedBytes = await deleteCapturePair(entry, context);
    if (removedBytes > 0) {
      kept -= 1;
      deleted += 1;
      bytesDeleted += removedBytes;
      totalBytes = Math.max(0, totalBytes - removedBytes);
    }
  }

  return { kept, deleted, bytesKept: totalBytes, bytesDeleted };
};

const saveDebugAudioCapture = async ({
  logsDir,
  audioBuffer,
  mimeType,
  sessionId,
  jobId,
  outputMode,
  durationSeconds,
  stopReason,
  stopSource,
  maxCaptures = DEFAULT_MAX_CAPTURES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  maxAudioBytes = MAX_DEBUG_AUDIO_BYTES,
} = {}) => {
  if (!logsDir || typeof logsDir !== "string") throw new Error("logsDir is required");
  if (!path.isAbsolute(logsDir)) throw new Error("logsDir must be an absolute path");
  const byteLength = getBinaryByteLength(audioBuffer);
  if (byteLength < 1 || byteLength > maxAudioBytes) {
    throw new Error("Debug audio capture is missing or exceeds the size limit");
  }

  const canonicalLogsDir = path.resolve(logsDir);
  await assertNoLinkedAncestors(canonicalLogsDir);
  const logsDirStat = await assertUnlinkedDirectory(canonicalLogsDir);
  const audioDir = path.join(canonicalLogsDir, AUDIO_SUBDIR);
  await fs.promises.mkdir(audioDir, { recursive: true });
  await assertUnlinkedDirectory(canonicalLogsDir, logsDirStat);
  const audioDirStat = await assertUnlinkedDirectory(audioDir);
  const audioDirHandle = await fs.promises.open(audioDir, "r");
  let windowsAudioDirIdentity = null;

  try {
    await assertOpenDirectoryIdentity(audioDir, audioDirStat, audioDirHandle);
    if (process.platform === "win32") windowsAudioDirIdentity = toWindowsIdentity(audioDirStat);

    const ts = makeSafeTimestamp(new Date());
    const sessionToken = sanitizeToken(
      sessionId ? String(sessionId).slice(0, 12) : "",
      "nosession"
    );
    const jobToken = sanitizeToken(jobId ?? "", "nojob");
    const rand = crypto.randomUUID().slice(0, 8);
    const ext = guessExtensionFromMimeType(mimeType);
    const baseName = `${AUDIO_PREFIX}${ts}-s${sessionToken}-j${jobToken}-${rand}`;
    const audioPath = path.join(audioDir, `${baseName}.${ext}`);
    const metaPath = path.join(audioDir, `${baseName}.json`);
    const buffer = toBuffer(audioBuffer);
    const metadata = JSON.stringify(
      {
        type: "debug_audio_capture",
        ts: new Date().toISOString(),
        fileName: path.basename(audioPath),
        mimeType: mimeType || null,
        bytes: buffer.length,
        sessionId: sessionId || null,
        jobId: jobId ?? null,
        outputMode: outputMode || null,
        durationSeconds: typeof durationSeconds === "number" ? durationSeconds : null,
        stopReason: stopReason || null,
        stopSource: stopSource || null,
      },
      null,
      2
    );
    const fileContext = {
      expectedParentStat: audioDirStat,
      parentHandle: audioDirHandle,
      windowsParentIdentity: windowsAudioDirIdentity,
    };

    const publications = [];
    try {
      publications.push(await stageFilePublication(audioPath, buffer, fileContext));
      publications.push(await stageFilePublication(metaPath, metadata, fileContext));
      const [audioPublishedStat, metaPublishedStat] = await commitPublicationPair(publications);
      const currentAudioStat = await statRegularFile(audioPath);
      const currentMetaStat = await statRegularFile(metaPath);
      if (
        !sameIdentity(audioPublishedStat, currentAudioStat) ||
        !sameIdentity(metaPublishedStat, currentMetaStat)
      ) {
        throw new Error("Debug capture output changed after publication");
      }
      await closePublicationHandles(publications);
    } catch (error) {
      await rollbackPublications(publications);
      throw error;
    }

    await assertUnlinkedDirectory(canonicalLogsDir, logsDirStat);
    await assertOpenDirectoryIdentity(audioDir, audioDirStat, audioDirHandle);
    const retentionContext = {
      root: audioDir,
      expectedRootStat: audioDirStat,
      rootHandle: audioDirHandle,
      windowsRootIdentity: windowsAudioDirIdentity,
    };
    const retention = await enforceRetention(
      audioDir,
      maxCaptures,
      maxTotalBytes,
      retentionContext
    );
    return {
      audioDir,
      filePath: audioPath,
      bytes: buffer.length,
      kept: retention.kept,
      deleted: retention.deleted,
      bytesKept: retention.bytesKept,
      bytesDeleted: retention.bytesDeleted,
    };
  } finally {
    await audioDirHandle.close().catch(() => {});
  }
};

module.exports = {
  AUDIO_PREFIX,
  DEFAULT_MAX_CAPTURES,
  DEFAULT_MAX_TOTAL_BYTES,
  MAX_DEBUG_AUDIO_BYTES,
  assertNoLinkedAncestors,
  assertOpenDirectoryIdentity,
  assertUnlinkedDirectory,
  enforceRetention,
  getBinaryByteLength,
  guessExtensionFromMimeType,
  makeSafeTimestamp,
  sanitizeToken,
  saveDebugAudioCapture,
};
