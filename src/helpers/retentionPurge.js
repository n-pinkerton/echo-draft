const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  DEBUG_LOG_PATTERN,
  MAX_ROOT_ENTRIES,
  deleteVerifiedPathDefault,
  isInsideRoot,
} = require("./debugArtifacts");

const RETENTION_DAYS = 30;
const RETENTION_MANIFEST_VERSION = 1;
const RETENTION_WINDOW_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

const describeError = (error) => error?.message || String(error);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalizePathIdentity = (value) => {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};
const toPathIdentity = (stat) => ({
  volumeSerialNumber: String(stat?.dev ?? ""),
  fileIndex: String(stat?.ino ?? ""),
});
const toRootIdentity = (stat) => ({
  dev: String(stat?.dev ?? ""),
  ino: String(stat?.ino ?? ""),
});
const toFileIdentity = (stat) => ({
  dev: String(stat?.dev ?? ""),
  ino: String(stat?.ino ?? ""),
  size: String(stat?.size ?? "0"),
  mtimeNs: String(stat?.mtimeNs ?? Math.trunc(Number(stat?.mtimeMs || 0) * 1_000_000)),
});
const sameObject = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const safeSize = (stat) => {
  const size = typeof stat?.size === "bigint" ? stat.size : BigInt(stat?.size || 0);
  if (size < 0n || size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("A retention log is too large to count safely");
  }
  return Number(size);
};

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
};

const retentionManifestBody = (manifest) => ({
  version: manifest.version,
  createdAtIso: manifest.createdAtIso,
  cutoffIso: manifest.cutoffIso,
  database: manifest.database,
  logs: manifest.logs,
  summary: manifest.summary,
});

const getLogDate = (name) => {
  if (!DEBUG_LOG_PATTERN.test(name)) return null;
  const match = /^echodraft-debug-(\d{4})-(\d{2})-(\d{2})/i.exec(name);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const localStart = new Date(year, month - 1, day);
  if (
    localStart.getFullYear() !== year ||
    localStart.getMonth() !== month - 1 ||
    localStart.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
};

const localDayEndEpoch = ({ year, month, day }) =>
  new Date(year, month - 1, day + 1, 0, 0, 0, 0).getTime();

const verifyNoLinkedAncestors = async (root) => {
  let current = path.resolve(root);
  while (true) {
    const stat = await fs.promises.lstat(current, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Refused a linked or invalid logs path ancestor: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
};

const inspectRoot = async (root) => {
  await verifyNoLinkedAncestors(root);
  const firstStat = await fs.promises.lstat(root, { bigint: true });
  if (firstStat.isSymbolicLink() || !firstStat.isDirectory()) {
    throw new Error("Refused an unverified or linked logs folder");
  }
  let handle;
  try {
    handle = await fs.promises.open(root, "r");
    const handleStat = await handle.stat({ bigint: true });
    if (!sameObject(toRootIdentity(firstStat), toRootIdentity(handleStat))) {
      throw new Error("The logs folder changed while it was being verified");
    }
  } finally {
    await handle?.close();
  }
  return firstStat;
};

const readRootEntries = async (root) => {
  const entries = [];
  let directory;
  try {
    directory = await fs.promises.opendir(root);
    for await (const entry of directory) {
      if (entries.length >= MAX_ROOT_ENTRIES) {
        throw new Error(`The logs folder contains more than ${MAX_ROOT_ENTRIES} entries`);
      }
      entries.push(entry);
    }
  } finally {
    try {
      await directory?.close();
    } catch {
      // Async directory iteration normally closes the handle.
    }
  }
  return entries;
};

const createLogSnapshot = async ({ debugLogger, cutoffEpoch }) => {
  const activePath = debugLogger.getLogPath?.();
  const activeIdentity = activePath ? normalizePathIdentity(activePath) : null;
  const roots = [];
  const candidates = [];
  const seenRoots = new Set();
  const summary = {
    files: 0,
    bytes: 0,
    activeLogsExcluded: 0,
    newerLogsExcluded: 0,
    audioEntriesExcluded: 0,
    otherEntriesExcluded: 0,
  };

  for (const value of debugLogger.getDebugArtifactRoots?.() || []) {
    if (typeof value !== "string" || !path.isAbsolute(value)) {
      throw new Error("A debug logs root is not an absolute path");
    }
    const root = path.resolve(value);
    const rootKey = normalizePathIdentity(root);
    if (seenRoots.has(rootKey)) continue;
    seenRoots.add(rootKey);

    let rootStat;
    try {
      rootStat = await inspectRoot(root);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    roots.push({ root, identity: toRootIdentity(rootStat) });
    const entries = await readRootEntries(root);
    for (const entry of entries) {
      if (entry.name.toLowerCase() === "audio") {
        summary.audioEntriesExcluded += 1;
        continue;
      }
      const logDate = getLogDate(entry.name);
      if (!logDate) {
        summary.otherEntriesExcluded += 1;
        continue;
      }
      const target = path.join(root, entry.name);
      if (!isInsideRoot(root, target)) {
        throw new Error("Refused a retention candidate outside its verified logs folder");
      }
      if (activeIdentity && normalizePathIdentity(target) === activeIdentity) {
        summary.activeLogsExcluded += 1;
        continue;
      }
      if (!(localDayEndEpoch(logDate) < cutoffEpoch)) {
        summary.newerLogsExcluded += 1;
        continue;
      }
      const stat = await fs.promises.lstat(target, { bigint: true });
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`Refused a linked or invalid retention log named ${entry.name}`);
      }
      const bytes = safeSize(stat);
      candidates.push({
        root,
        path: target,
        name: entry.name,
        logDate: `${String(logDate.year).padStart(4, "0")}-${String(logDate.month).padStart(2, "0")}-${String(logDate.day).padStart(2, "0")}`,
        bytes,
        identity: toFileIdentity(stat),
      });
      summary.files += 1;
      summary.bytes += bytes;
    }
  }

  candidates.sort((left, right) =>
    normalizePathIdentity(left.path).localeCompare(normalizePathIdentity(right.path))
  );
  roots.sort((left, right) =>
    normalizePathIdentity(left.root).localeCompare(normalizePathIdentity(right.root))
  );
  return { roots, candidates, summary };
};

const createRetentionManifest = async ({
  databaseManager,
  debugLogger,
  now = () => new Date(),
}) => {
  if (typeof databaseManager?.buildRetentionDatabaseSnapshot !== "function") {
    throw new Error("Retention database preview is unavailable");
  }
  if (!debugLogger || typeof debugLogger.getDebugArtifactRoots !== "function") {
    throw new Error("Retention log preview is unavailable");
  }
  const capturedNow = now();
  const nowDate =
    capturedNow instanceof Date ? new Date(capturedNow.getTime()) : new Date(capturedNow);
  if (!Number.isFinite(nowDate.getTime()))
    throw new Error("Retention clock returned an invalid time");
  const cutoffDate = new Date(nowDate.getTime() - RETENTION_WINDOW_MS);
  const cutoffIso = cutoffDate.toISOString();
  const database = databaseManager.buildRetentionDatabaseSnapshot(cutoffIso);
  const logs = await createLogSnapshot({ debugLogger, cutoffEpoch: cutoffDate.getTime() });
  const summary = {
    ...database.summary,
    logFiles: logs.summary.files,
    logBytes: logs.summary.bytes,
  };
  const body = {
    version: RETENTION_MANIFEST_VERSION,
    createdAtIso: nowDate.toISOString(),
    cutoffIso,
    database,
    logs,
    summary,
  };
  const manifest = { ...body, digest: sha256(JSON.stringify(body)) };
  return deepFreeze(manifest);
};

const validateManifestDigest = (manifest) => {
  if (
    !manifest ||
    manifest.version !== RETENTION_MANIFEST_VERSION ||
    manifest.digest !== sha256(JSON.stringify(retentionManifestBody(manifest)))
  ) {
    throw new Error("The retention preview is invalid or was changed");
  }
};

const validateRoot = async (entry) => {
  const stat = await inspectRoot(entry.root);
  if (!sameObject(toRootIdentity(stat), entry.identity)) {
    throw new Error("A verified logs folder changed after the retention preview");
  }
  return stat;
};

const validateCandidate = async (candidate, cutoffEpoch, activeIdentity) => {
  if (
    !isInsideRoot(candidate.root, candidate.path) ||
    path.basename(candidate.path) !== candidate.name
  ) {
    throw new Error(`Invalid retention path for ${candidate.name}`);
  }
  const logDate = getLogDate(candidate.name);
  if (!logDate || !(localDayEndEpoch(logDate) < cutoffEpoch)) {
    throw new Error(`${candidate.name} is not strictly older than the retention cutoff`);
  }
  if (activeIdentity && normalizePathIdentity(candidate.path) === activeIdentity) {
    throw new Error(`${candidate.name} became the active log after the retention preview`);
  }
  const stat = await fs.promises.lstat(candidate.path, { bigint: true });
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    !sameObject(toFileIdentity(stat), candidate.identity)
  ) {
    throw new Error(`${candidate.name} changed after the retention preview`);
  }
  return stat;
};

const prevalidateRetentionManifest = async ({ manifest, databaseManager, debugLogger }) => {
  validateManifestDigest(manifest);
  const failures = [];
  const currentDatabase = databaseManager.buildRetentionDatabaseSnapshot(manifest.cutoffIso);
  if (!sameObject(currentDatabase, manifest.database)) {
    failures.push("History or To Do data changed after the retention preview");
  }
  const activePath = debugLogger.getLogPath?.();
  const activeIdentity = activePath ? normalizePathIdentity(activePath) : null;
  const cutoffEpoch = Date.parse(manifest.cutoffIso);
  for (const root of manifest.logs.roots) {
    try {
      await validateRoot(root);
    } catch (error) {
      failures.push(describeError(error));
    }
  }
  for (const candidate of manifest.logs.candidates) {
    try {
      await validateCandidate(candidate, cutoffEpoch, activeIdentity);
    } catch (error) {
      failures.push(describeError(error));
    }
  }
  if (failures.length > 0) {
    const error = new Error(
      `Retention candidates changed after preview; nothing was deleted. ${failures.join("; ")}`
    );
    error.code = "RETENTION_MANIFEST_CHANGED";
    error.failures = failures;
    throw error;
  }
  return true;
};

const emptyFileResult = () => ({
  success: false,
  filesDeleted: 0,
  bytesDeleted: 0,
  residualFiles: 0,
  residualBytes: 0,
  errors: [],
});

const executeRetentionManifest = async ({
  manifest,
  databaseManager,
  debugLogger,
  deleteVerifiedPath = deleteVerifiedPathDefault,
}) => {
  try {
    await prevalidateRetentionManifest({ manifest, databaseManager, debugLogger });
  } catch (error) {
    return {
      success: false,
      aborted: true,
      changed: error?.code === "RETENTION_MANIFEST_CHANGED",
      cutoffIso: manifest?.cutoffIso || null,
      database: { success: false, historyDeleted: 0, todosDeleted: 0 },
      logs: emptyFileResult(),
      errors: [describeError(error)],
    };
  }

  let database;
  try {
    database = databaseManager.deleteRetentionDatabaseSnapshot(manifest.database);
  } catch (error) {
    return {
      success: false,
      aborted: true,
      changed: error?.code === "RETENTION_MANIFEST_CHANGED",
      cutoffIso: manifest.cutoffIso,
      database: {
        success: false,
        historyDeleted: 0,
        todosDeleted: 0,
        error: describeError(error),
      },
      logs: emptyFileResult(),
      errors: [describeError(error)],
    };
  }

  const logs = emptyFileResult();
  const rootByPath = new Map(
    manifest.logs.roots.map((entry) => [normalizePathIdentity(entry.root), entry])
  );
  const activePath = debugLogger.getLogPath?.();
  const activeIdentity = activePath ? normalizePathIdentity(activePath) : null;
  const cutoffEpoch = Date.parse(manifest.cutoffIso);
  for (const candidate of manifest.logs.candidates) {
    try {
      const rootEntry = rootByPath.get(normalizePathIdentity(candidate.root));
      if (!rootEntry) throw new Error(`Missing verified root for ${candidate.name}`);
      const rootStat = await validateRoot(rootEntry);
      await validateCandidate(candidate, cutoffEpoch, activeIdentity);
      const deletion = await deleteVerifiedPath(candidate.root, candidate.path, {
        expectDirectory: false,
        expectedRootIdentity: toPathIdentity(rootStat),
        expectedTargetIdentity: {
          volumeSerialNumber: candidate.identity.dev,
          fileIndex: candidate.identity.ino,
        },
      });
      if (!deletion?.success) {
        throw new Error(deletion?.error || "verified deletion failed");
      }
      if (deletion.deleted !== true) {
        throw new Error("verified deletion did not confirm removal");
      }
      try {
        await fs.promises.lstat(candidate.path, { bigint: true });
        throw new Error("the file still exists after deletion");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      logs.filesDeleted += 1;
      logs.bytesDeleted +=
        Number.isSafeInteger(deletion.bytes) && deletion.bytes >= 0
          ? deletion.bytes
          : candidate.bytes;
    } catch (error) {
      logs.errors.push(`Could not delete ${candidate.name}: ${describeError(error)}`);
    }
  }

  for (const candidate of manifest.logs.candidates) {
    try {
      const stat = await fs.promises.lstat(candidate.path, { bigint: true });
      if (!stat.isSymbolicLink() && stat.isFile()) {
        logs.residualFiles += 1;
        logs.residualBytes += safeSize(stat);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        logs.errors.push(`Could not verify removal of ${candidate.name}: ${describeError(error)}`);
      }
    }
  }
  logs.success = logs.errors.length === 0 && logs.residualFiles === 0;
  const errors = [...logs.errors];
  return {
    success: Boolean(database.success) && logs.success,
    aborted: false,
    changed: false,
    cutoffIso: manifest.cutoffIso,
    database,
    logs,
    errors,
  };
};

module.exports = {
  RETENTION_DAYS,
  RETENTION_MANIFEST_VERSION,
  RETENTION_WINDOW_MS,
  createRetentionManifest,
  executeRetentionManifest,
  getLogDate,
  localDayEndEpoch,
  prevalidateRetentionManifest,
};
