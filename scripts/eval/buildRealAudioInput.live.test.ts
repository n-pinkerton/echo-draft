// @vitest-environment node
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

import dotenv from "dotenv";
import { describe, expect, it, vi } from "vitest";

import { OpenAiTranscriber } from "../../src/helpers/audio/transcription/openAiTranscriber.js";
import windowsHandleDelete from "../../src/helpers/windowsHandleDelete.js";
import { createSecureProviderTestBridge } from "./secureProviderTestBridge";

const { deleteWindowsPathByHandleSync } = windowsHandleDelete as {
  deleteWindowsPathByHandleSync: (
    root: string,
    target: string,
    options: {
      expectDirectory?: boolean;
      expectedRootIdentity: { volumeSerialNumber: string; fileIndex: string };
      expectedTargetIdentity: { volumeSerialNumber: string; fileIndex: string };
    }
  ) => { success?: boolean; deleted?: boolean; error?: string };
};

type CaptureMetadata = {
  type: "debug_audio_capture";
  fileName: string;
  durationSeconds: number;
  bytes: number;
};

type CapturePair = {
  audioPath: string;
  metadata: CaptureMetadata;
  sourceIdentity?: SourceIdentity;
};

type PathIdentity = {
  canonicalPath: string;
  dev: bigint;
  ino: bigint;
};

type SourceIdentity = PathIdentity & {
  size: bigint;
};

type Snapshot = {
  audioPath: string;
  audioFile: string;
  durationSeconds: number;
  bytes: number;
  sha256: string;
  identity: PathIdentity;
  fd: number | null;
};

type SnapshotSet = {
  snapshotRoot: string;
  snapshots: Snapshot[];
  outputParentIdentity: PathIdentity;
  snapshotRootIdentity: PathIdentity;
  outputParentFd: number | null;
  snapshotRootFd: number | null;
};

type SnapshotCleanupHooks = {
  beforeDeleteSnapshot?: (snapshot: Snapshot) => void;
};

type SelectedEnvironment = Record<string, string>;

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const enabled = process.env.ECHODRAFT_RUN_BUILD_REAL_AUDIO_INPUT === "1";
const liveIt = enabled ? it : it.skip;
const repoRoot = fs.realpathSync(path.resolve(import.meta.dirname, "../.."));

const noContentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
};

const isInside = (parent: string, candidate: string) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const capturePathIdentity = (target: string, expectedKind: "file" | "directory"): PathIdentity => {
  const resolved = path.resolve(target);
  const entry = fs.lstatSync(resolved, { bigint: true, throwIfNoEntry: false });
  const expectedType = expectedKind === "file" ? entry?.isFile() : entry?.isDirectory();
  if (!entry || entry.isSymbolicLink() || !expectedType || fs.realpathSync(resolved) !== resolved) {
    throw new Error(`The retained ${expectedKind} path is not a canonical regular entry.`);
  }
  return { canonicalPath: resolved, dev: entry.dev, ino: entry.ino };
};

const captureSourceIdentity = (target: string, expectedBytes: number): SourceIdentity => {
  const resolved = path.resolve(target);
  const entry = fs.lstatSync(resolved, { bigint: true, throwIfNoEntry: false });
  if (
    !entry?.isFile() ||
    entry.isSymbolicLink() ||
    entry.size !== BigInt(expectedBytes) ||
    fs.realpathSync(resolved) !== resolved
  ) {
    throw new Error("A source capture is not the retained canonical regular file.");
  }
  return { canonicalPath: resolved, dev: entry.dev, ino: entry.ino, size: entry.size };
};

const sourceIdentityMatches = (entry: fs.BigIntStats, expected: SourceIdentity) =>
  entry.isFile() &&
  !entry.isSymbolicLink() &&
  entry.dev === expected.dev &&
  entry.ino === expected.ino &&
  entry.size === expected.size;

const assertPathIdentity = (target: string, expected: PathIdentity, kind: "file" | "directory") => {
  const actual = capturePathIdentity(target, kind);
  if (
    actual.canonicalPath !== expected.canonicalPath ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino
  ) {
    throw new Error(`The retained ${kind} path identity changed.`);
  }
};

const retainedEntryMatches = (
  entry: fs.BigIntStats,
  expected: PathIdentity,
  kind: "file" | "directory"
) =>
  (kind === "file" ? entry.isFile() : entry.isDirectory()) &&
  entry.dev === expected.dev &&
  entry.ino === expected.ino;

const assertRetainedPathIdentity = (
  target: string,
  expected: PathIdentity,
  kind: "file" | "directory",
  fd: number | null
) => {
  if (fd === null) throw new Error(`The retained ${kind} handle is closed.`);
  assertPathIdentity(target, expected, kind);
  if (!retainedEntryMatches(fs.fstatSync(fd, { bigint: true }), expected, kind)) {
    throw new Error(`The retained ${kind} handle no longer matches its verified path.`);
  }
};

const toWindowsIdentity = (identity: PathIdentity) => ({
  volumeSerialNumber: String(identity.dev),
  fileIndex: String(identity.ino),
});

const assertSameEntryIdentity = (target: string, expected: PathIdentity) => {
  const actual = capturePathIdentity(target, "file");
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error("The published file identity changed.");
  }
};

const sha256 = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");

const resolveThroughExistingParent = (target: string) => {
  let existingParent = target;
  while (!fs.existsSync(existingParent)) {
    const next = path.dirname(existingParent);
    if (next === existingParent) break;
    existingParent = next;
  }
  return path.join(fs.realpathSync(existingParent), path.relative(existingParent, target));
};

const parseSelectedEnvironment = (envPath: string): SelectedEnvironment => {
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, value.trim()]));
};

const requireEnvironmentValue = (environment: SelectedEnvironment, name: string) => {
  const value = environment[name];
  if (!value) throw new Error(`Required environment variable ${name} is unavailable.`);
  return value;
};

const requireCanonicalPath = (
  environment: SelectedEnvironment,
  name: string,
  options: { mustExist: boolean; extension?: string }
) => {
  const value = requireEnvironmentValue(environment, name);
  if (
    !path.isAbsolute(value) ||
    value.split(/[\\/]+/).includes("..") ||
    path.normalize(value) !== value
  ) {
    throw new Error(`${name} must be an absolute canonical path without traversal.`);
  }
  if (options.extension && path.extname(value).toLowerCase() !== options.extension) {
    throw new Error(`${name} must end in ${options.extension}.`);
  }
  const resolved = options.mustExist ? fs.realpathSync(value) : resolveThroughExistingParent(value);
  if (path.normalize(resolved) !== value) {
    throw new Error(`${name} must not use symlinks, junctions, or aliases.`);
  }
  return value;
};

const readMetadata = (metadataPath: string, audioFile: string): CaptureMetadata => {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  } catch {
    throw new Error("A capture metadata file is unreadable or is not valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A capture metadata file is malformed.");
  }
  const metadata = value as Record<string, unknown>;
  if (
    metadata.type !== "debug_audio_capture" ||
    metadata.fileName !== audioFile ||
    typeof metadata.durationSeconds !== "number" ||
    !Number.isFinite(metadata.durationSeconds) ||
    metadata.durationSeconds <= 0 ||
    typeof metadata.bytes !== "number" ||
    !Number.isSafeInteger(metadata.bytes) ||
    metadata.bytes <= 0
  ) {
    throw new Error("A capture metadata file is malformed or does not match its audio file.");
  }

  return {
    type: "debug_audio_capture",
    fileName: audioFile,
    durationSeconds: metadata.durationSeconds,
    bytes: metadata.bytes,
  };
};

const loadCapturePairs = (audioRoot: string) => {
  if (!fs.statSync(audioRoot, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("The configured audio root is unavailable or is not a directory.");
  }

  const entries = fs.readdirSync(audioRoot, { withFileTypes: true });
  const webmFiles = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".webm")
    .map((entry) => entry.name)
    .sort();
  const jsonNames = new Set(
    entries
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
      .map((entry) => entry.name)
  );

  if (webmFiles.length === 0) throw new Error("No WebM captures were found.");
  if (jsonNames.size !== webmFiles.length) {
    throw new Error("The audio root contains missing or orphaned capture metadata.");
  }

  return webmFiles.map((audioFile): CapturePair => {
    const metadataFile = `${path.parse(audioFile).name}.json`;
    if (!jsonNames.delete(metadataFile)) {
      throw new Error("A WebM capture is missing its matching metadata file.");
    }
    const audioPath = path.join(audioRoot, audioFile);
    if (fs.lstatSync(audioPath).isSymbolicLink() || fs.realpathSync(audioPath) !== audioPath) {
      throw new Error("Capture files must not be symlinks, junction aliases, or path escapes.");
    }
    const metadata = readMetadata(path.join(audioRoot, metadataFile), audioFile);
    const sourceIdentity = captureSourceIdentity(audioPath, metadata.bytes);
    return {
      audioPath,
      metadata,
      sourceIdentity,
    };
  });
};

const requireUniqueMeaningfulSnapshots = (
  snapshots: Array<{ durationSeconds: number; sha256: string }>
) => {
  const signatures = new Set(
    snapshots
      .filter((snapshot) => snapshot.durationSeconds >= 2)
      .map((snapshot) => snapshot.sha256)
  );
  if (signatures.size < 3) {
    throw new Error(
      "At least three unique meaningful recordings are required before network work."
    );
  }
};

const snapshotFileName = (index: number) => `capture-${String(index + 1).padStart(3, "0")}.webm`;

const releaseSnapshotHandles = (snapshotSet: SnapshotSet) => {
  let firstFailure: unknown = null;
  const close = (fd: number | null) => {
    if (fd === null) return;
    try {
      fs.closeSync(fd);
    } catch (error) {
      firstFailure ||= error;
    }
  };

  for (const snapshot of snapshotSet.snapshots) {
    const fd = snapshot.fd;
    snapshot.fd = null;
    close(fd);
  }
  const snapshotRootFd = snapshotSet.snapshotRootFd;
  snapshotSet.snapshotRootFd = null;
  close(snapshotRootFd);
  const outputParentFd = snapshotSet.outputParentFd;
  snapshotSet.outputParentFd = null;
  close(outputParentFd);
  if (firstFailure) throw firstFailure;
};

const validateSnapshotSetPaths = (snapshotSet: SnapshotSet) => {
  assertRetainedPathIdentity(
    snapshotSet.outputParentIdentity.canonicalPath,
    snapshotSet.outputParentIdentity,
    "directory",
    snapshotSet.outputParentFd
  );
  assertRetainedPathIdentity(
    snapshotSet.snapshotRoot,
    snapshotSet.snapshotRootIdentity,
    "directory",
    snapshotSet.snapshotRootFd
  );
};

const deleteRetainedSnapshotPath = (
  snapshotSet: SnapshotSet,
  snapshot: Snapshot,
  hooks: SnapshotCleanupHooks = {}
) => {
  validateSnapshotSetPaths(snapshotSet);
  assertRetainedPathIdentity(snapshot.audioPath, snapshot.identity, "file", snapshot.fd);
  hooks.beforeDeleteSnapshot?.(snapshot);

  if (process.platform === "win32") {
    const result = deleteWindowsPathByHandleSync(snapshotSet.snapshotRoot, snapshot.audioPath, {
      expectDirectory: false,
      expectedRootIdentity: toWindowsIdentity(snapshotSet.snapshotRootIdentity),
      expectedTargetIdentity: toWindowsIdentity(snapshot.identity),
    });
    if (!result?.success) {
      throw new Error(result?.error || "The retained private snapshot could not be removed safely.");
    }
    return;
  }

  // POSIX has no portable unlink-by-open-handle API in Node. Revalidate both
  // retained identities at the last possible point and never follow a mismatch.
  validateSnapshotSetPaths(snapshotSet);
  assertRetainedPathIdentity(snapshot.audioPath, snapshot.identity, "file", snapshot.fd);
  fs.unlinkSync(snapshot.audioPath);
};

const deleteRetainedSnapshotRoot = (snapshotSet: SnapshotSet) => {
  assertRetainedPathIdentity(
    snapshotSet.outputParentIdentity.canonicalPath,
    snapshotSet.outputParentIdentity,
    "directory",
    snapshotSet.outputParentFd
  );
  assertRetainedPathIdentity(
    snapshotSet.snapshotRoot,
    snapshotSet.snapshotRootIdentity,
    "directory",
    snapshotSet.snapshotRootFd
  );

  if (process.platform === "win32") {
    const result = deleteWindowsPathByHandleSync(
      snapshotSet.outputParentIdentity.canonicalPath,
      snapshotSet.snapshotRoot,
      {
        expectDirectory: true,
        expectedRootIdentity: toWindowsIdentity(snapshotSet.outputParentIdentity),
        expectedTargetIdentity: toWindowsIdentity(snapshotSet.snapshotRootIdentity),
      }
    );
    if (!result?.success) {
      throw new Error(result?.error || "The private snapshot directory could not be removed safely.");
    }
    return;
  }

  assertRetainedPathIdentity(
    snapshotSet.snapshotRoot,
    snapshotSet.snapshotRootIdentity,
    "directory",
    snapshotSet.snapshotRootFd
  );
  fs.rmdirSync(snapshotSet.snapshotRoot);
};

const removeFailedSnapshot = (
  snapshotSet: SnapshotSet,
  hooks: SnapshotCleanupHooks = {}
) => {
  let firstFailure: unknown = null;
  const recordFailure = (error: unknown) => {
    firstFailure ||= error;
  };

  // Erase every exact retained file before any pathname can be consulted or
  // removed. A successful pathname swap can therefore leave only zero bytes.
  for (const snapshot of snapshotSet.snapshots) {
    if (snapshot.fd === null) continue;
    try {
      fs.ftruncateSync(snapshot.fd, 0);
      fs.fsyncSync(snapshot.fd);
    } catch (error) {
      recordFailure(error);
    }
  }

  for (const snapshot of snapshotSet.snapshots) {
    try {
      deleteRetainedSnapshotPath(snapshotSet, snapshot, hooks);
    } catch (error) {
      recordFailure(error);
    }
  }

  // Windows cannot remove the directory until delete-pending child handles
  // close. Close only after every private descriptor has already been scrubbed.
  for (const snapshot of snapshotSet.snapshots) {
    const fd = snapshot.fd;
    snapshot.fd = null;
    if (fd === null) continue;
    try {
      fs.closeSync(fd);
    } catch (error) {
      recordFailure(error);
    }
  }

  try {
    deleteRetainedSnapshotRoot(snapshotSet);
  } catch (error) {
    recordFailure(error);
  }

  try {
    releaseSnapshotHandles(snapshotSet);
  } catch (error) {
    recordFailure(error);
  }
  if (firstFailure) throw firstFailure;
};

const readValidatedSnapshot = (snapshotSet: SnapshotSet, snapshot: Snapshot) => {
  validateSnapshotSetPaths(snapshotSet);
  assertRetainedPathIdentity(snapshot.audioPath, snapshot.identity, "file", snapshot.fd);
  if (snapshot.fd === null) throw new Error("The retained private audio handle is closed.");
  const beforeRead = fs.fstatSync(snapshot.fd, { bigint: true });
  if (beforeRead.size !== BigInt(snapshot.bytes)) {
    throw new Error("A retained private audio snapshot changed before upload.");
  }

  const bytes = Buffer.allocUnsafe(snapshot.bytes);
  let offset = 0;
  while (offset < bytes.length) {
    const bytesRead = fs.readSync(snapshot.fd, bytes, offset, bytes.length - offset, offset);
    if (bytesRead <= 0) {
      throw new Error("A retained private audio snapshot ended before upload.");
    }
    offset += bytesRead;
  }

  assertRetainedPathIdentity(snapshot.audioPath, snapshot.identity, "file", snapshot.fd);
  const afterRead = fs.fstatSync(snapshot.fd, { bigint: true });
  if (afterRead.size !== BigInt(snapshot.bytes) || sha256(bytes) !== snapshot.sha256) {
    throw new Error("A retained private audio snapshot changed before upload.");
  }
  return bytes;
};

const validateSnapshotsBeforePublication = (snapshotSet: SnapshotSet) => {
  for (const snapshot of snapshotSet.snapshots) readValidatedSnapshot(snapshotSet, snapshot);
};

const copyRetainedSourceToSnapshot = (
  pair: CapturePair,
  audioPath: string,
  snapshotSet: SnapshotSet
) => {
  const expectedSource =
    pair.sourceIdentity || captureSourceIdentity(pair.audioPath, pair.metadata.bytes);
  const openFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let sourceFd: number | undefined;
  let destinationFd: number | undefined;
  let destinationIdentity: PathIdentity | undefined;
  try {
    validateSnapshotSetPaths(snapshotSet);
    sourceFd = fs.openSync(pair.audioPath, openFlags);
    const sourceBefore = fs.fstatSync(sourceFd, { bigint: true });
    const sourcePathAtOpen = fs.lstatSync(pair.audioPath, { bigint: true });
    if (
      !sourceIdentityMatches(sourceBefore, expectedSource) ||
      !sourceIdentityMatches(sourcePathAtOpen, expectedSource) ||
      fs.realpathSync(pair.audioPath) !== expectedSource.canonicalPath
    ) {
      throw new Error("A source capture changed before its retained handle was validated.");
    }

    destinationFd = fs.openSync(audioPath, "wx+", 0o600);
    const destinationBefore = fs.fstatSync(destinationFd, { bigint: true });
    destinationIdentity = {
      canonicalPath: path.resolve(audioPath),
      dev: destinationBefore.dev,
      ino: destinationBefore.ino,
    };
    // Revalidate the retained root immediately after the pathname open and
    // before the first private byte is written.
    validateSnapshotSetPaths(snapshotSet);
    assertPathIdentity(audioPath, destinationIdentity, "file");

    const digest = crypto.createHash("sha256");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let copiedBytes = 0;
    while (true) {
      const bytesRead = fs.readSync(sourceFd, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      let offset = 0;
      while (offset < bytesRead) {
        const written = fs.writeSync(destinationFd, chunk, offset, bytesRead - offset);
        if (written <= 0) throw new Error("A private audio snapshot write made no progress.");
        offset += written;
      }
      digest.update(chunk.subarray(0, bytesRead));
      copiedBytes += bytesRead;
      if (copiedBytes > pair.metadata.bytes) {
        throw new Error("A source capture exceeded its retained size while being copied.");
      }
    }
    fs.fsyncSync(destinationFd);

    const sourceAfter = fs.fstatSync(sourceFd, { bigint: true });
    const sourcePathAfter = fs.lstatSync(pair.audioPath, { bigint: true });
    const destinationAfter = fs.fstatSync(destinationFd, { bigint: true });
    if (
      !sourceIdentityMatches(sourceAfter, expectedSource) ||
      !sourceIdentityMatches(sourcePathAfter, expectedSource) ||
      fs.realpathSync(pair.audioPath) !== expectedSource.canonicalPath ||
      copiedBytes !== pair.metadata.bytes ||
      destinationAfter.dev !== destinationIdentity.dev ||
      destinationAfter.ino !== destinationIdentity.ino ||
      destinationAfter.size !== BigInt(copiedBytes)
    ) {
      throw new Error("A source capture or private snapshot changed while being copied.");
    }
    validateSnapshotSetPaths(snapshotSet);
    assertPathIdentity(audioPath, destinationIdentity, "file");

    fs.closeSync(sourceFd);
    sourceFd = undefined;
    const retainedFd = destinationFd;
    destinationFd = undefined;
    return {
      bytes: copiedBytes,
      sha256: digest.digest("hex"),
      identity: destinationIdentity,
      fd: retainedFd,
    };
  } catch (error) {
    if (destinationFd !== undefined) {
      try {
        fs.ftruncateSync(destinationFd, 0);
        fs.fsyncSync(destinationFd);
      } catch {
        // Continue with retained-identity cleanup.
      }
    }
    if (sourceFd !== undefined) {
      try {
        fs.closeSync(sourceFd);
      } catch {
        // The descriptor may already be closed.
      }
    }
    if (destinationIdentity) {
      try {
        deleteRetainedSnapshotPath(snapshotSet, {
          audioPath,
          audioFile: path.basename(audioPath),
          durationSeconds: pair.metadata.durationSeconds,
          bytes: 0,
          sha256: "",
          identity: destinationIdentity,
          fd: destinationFd ?? null,
        });
      } catch {
        // Never follow a destination pathname that no longer identifies this run's file.
      }
    }
    if (destinationFd !== undefined) {
      try {
        fs.closeSync(destinationFd);
      } catch {
        // The descriptor may already be closed.
      }
    }
    throw error;
  }
};

const snapshotCaptures = (pairs: CapturePair[], outputPath: string) => {
  const outputDirectory = path.dirname(outputPath);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputParentIdentity = capturePathIdentity(outputDirectory, "directory");
  let outputParentFd: number | null = null;
  let snapshotRoot = "";
  let snapshotSet: SnapshotSet | null = null;
  try {
    outputParentFd = fs.openSync(outputDirectory, "r");
    assertRetainedPathIdentity(
      outputDirectory,
      outputParentIdentity,
      "directory",
      outputParentFd
    );
    snapshotRoot = fs.mkdtempSync(path.join(outputDirectory, "echodraft-real-audio-"));
    const snapshotRootIdentity = capturePathIdentity(snapshotRoot, "directory");
    const snapshotRootFd = fs.openSync(snapshotRoot, "r");
    const snapshots: Snapshot[] = [];
    snapshotSet = {
      snapshotRoot,
      snapshots,
      outputParentIdentity,
      snapshotRootIdentity,
      outputParentFd,
      snapshotRootFd,
    };
    outputParentFd = null;
    validateSnapshotSetPaths(snapshotSet);
    if (isInside(repoRoot, fs.realpathSync(snapshotRoot))) {
      throw new Error("The private audio snapshot must be written outside the repository.");
    }

    pairs.forEach((pair, index) => {
      const audioFile = snapshotFileName(index);
      const audioPath = path.join(snapshotRoot, audioFile);
      validateSnapshotSetPaths(snapshotSet!);
      const copied = copyRetainedSourceToSnapshot(pair, audioPath, snapshotSet!);
      snapshots.push({
        audioPath,
        audioFile,
        durationSeconds: pair.metadata.durationSeconds,
        bytes: copied.bytes,
        sha256: copied.sha256,
        identity: copied.identity,
        fd: copied.fd,
      });
    });

    const expectedFiles = snapshots.map((snapshot) => snapshot.audioFile).sort();
    const actualFiles = fs.readdirSync(snapshotRoot).sort();
    if (
      actualFiles.length !== expectedFiles.length ||
      actualFiles.some((fileName, index) => fileName !== expectedFiles[index])
    ) {
      throw new Error("The private audio snapshot is incomplete.");
    }
    validateSnapshotSetPaths(snapshotSet);
    for (const snapshot of snapshots) {
      assertRetainedPathIdentity(snapshot.audioPath, snapshot.identity, "file", snapshot.fd);
    }
    return snapshotSet;
  } catch {
    if (snapshotSet) {
      try {
        removeFailedSnapshot(snapshotSet);
      } catch {
        // Every retained private descriptor was scrubbed before cleanup was attempted.
      }
    } else {
      if (outputParentFd !== null) {
        try {
          fs.closeSync(outputParentFd);
        } catch {
          // No private bytes exist yet.
        }
      }
      if (snapshotRoot) {
        try {
          fs.rmdirSync(snapshotRoot);
        } catch {
          // No private bytes exist yet.
        }
      }
    }
    throw new Error("The private audio snapshot could not be completed and validated.");
  }
};

const runWithSnapshotRetention = async <T>(
  snapshotSet: SnapshotSet,
  operation: () => Promise<T>
) => {
  let completed = false;
  try {
    const result = await operation();
    completed = true;
    return result;
  } finally {
    if (!completed) {
      removeFailedSnapshot(snapshotSet);
    } else {
      releaseSnapshotHandles(snapshotSet);
    }
  }
};

type ExclusiveWriter = (fd: number, bytes: Buffer) => void;

const writeAll: ExclusiveWriter = (fd, bytes) => {
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error("The private evaluation input could not be written.");
    offset += written;
  }
};

const publishJsonAtomically = (
  outputPath: string,
  value: unknown,
  outputParentIdentity: PathIdentity,
  writer: ExclusiveWriter = writeAll
) => {
  const outputDirectory = path.dirname(outputPath);
  assertPathIdentity(outputDirectory, outputParentIdentity, "directory");
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(outputPath)}.${crypto.randomUUID()}.tmp`
  );
  const bytes = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  let fd: number | undefined;
  let temporaryIdentity: PathIdentity | undefined;
  let published = false;
  try {
    fd = fs.openSync(temporaryPath, "wx", 0o600);
    temporaryIdentity = capturePathIdentity(temporaryPath, "file");
    writer(fd, bytes);
    fs.fsyncSync(fd);

    assertPathIdentity(outputDirectory, outputParentIdentity, "directory");
    assertPathIdentity(temporaryPath, temporaryIdentity, "file");
    fs.linkSync(temporaryPath, outputPath);
    published = true;
    assertPathIdentity(outputDirectory, outputParentIdentity, "directory");
    assertSameEntryIdentity(outputPath, temporaryIdentity);
    fs.closeSync(fd);
    fd = undefined;
    fs.unlinkSync(temporaryPath);
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.ftruncateSync(fd, 0);
      } catch {
        // Continue with identity-checked pathname cleanup.
      }
      try {
        fs.closeSync(fd);
      } catch {
        // The descriptor may already have been closed by a failed close operation.
      }
      fd = undefined;
    }
    if (temporaryIdentity) {
      try {
        assertPathIdentity(temporaryPath, temporaryIdentity, "file");
        fs.unlinkSync(temporaryPath);
      } catch {
        // Never follow a temporary pathname that no longer identifies this run's file.
      }
    }
    if (published) {
      try {
        assertSameEntryIdentity(outputPath, temporaryIdentity!);
        fs.unlinkSync(outputPath);
      } catch {
        // Never remove an output pathname replaced by another process.
      }
    }
    throw error;
  }
};

const retainExistingSnapshotSet = (snapshotRoot: string): SnapshotSet => {
  const outputDirectory = path.dirname(snapshotRoot);
  const outputParentIdentity = capturePathIdentity(outputDirectory, "directory");
  const snapshotRootIdentity = capturePathIdentity(snapshotRoot, "directory");
  const outputParentFd = fs.openSync(outputDirectory, "r");
  let snapshotRootFd: number | null = null;
  const snapshots: Snapshot[] = [];
  let snapshotSet: SnapshotSet | null = null;
  try {
    snapshotRootFd = fs.openSync(snapshotRoot, "r");
    snapshotSet = {
      snapshotRoot,
      snapshots,
      outputParentIdentity,
      snapshotRootIdentity,
      outputParentFd,
      snapshotRootFd,
    };
    validateSnapshotSetPaths(snapshotSet);
    for (const audioFile of fs.readdirSync(snapshotRoot)) {
      const audioPath = path.join(snapshotRoot, audioFile);
      const bytes = fs.readFileSync(audioPath);
      const identity = capturePathIdentity(audioPath, "file");
      const fd = fs.openSync(audioPath, "r+");
      const snapshot: Snapshot = {
        audioPath,
        audioFile,
        durationSeconds: 1,
        bytes: bytes.length,
        sha256: sha256(bytes),
        identity,
        fd,
      };
      snapshots.push(snapshot);
      assertRetainedPathIdentity(audioPath, identity, "file", fd);
    }
    return snapshotSet;
  } catch (error) {
    if (snapshotSet) {
      try {
        releaseSnapshotHandles(snapshotSet);
      } catch {
        // Preserve the original construction failure.
      }
    } else {
      if (snapshotRootFd !== null) fs.closeSync(snapshotRootFd);
      fs.closeSync(outputParentFd);
    }
    throw error;
  }
};

describe("private real-audio snapshots", () => {
  it("uses generic names and validates copied sizes", () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-snapshot-source-"));
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-snapshot-output-"));
    const sourcePaths = [
      path.join(sourceRoot, "source-a.webm"),
      path.join(sourceRoot, "source-b.webm"),
      path.join(sourceRoot, "source-c.webm"),
    ];
    const fixtureBytes = [
      Buffer.from([1, 2, 3]),
      Buffer.from([4, 5, 6, 7, 8]),
      Buffer.from([9, 10, 11, 12]),
    ];
    let snapshotRoot = "";
    let snapshotSet: SnapshotSet | null = null;

    try {
      fixtureBytes.forEach((bytes, index) => fs.writeFileSync(sourcePaths[index], bytes));
      const pairs: CapturePair[] = sourcePaths.map((audioPath, index) => ({
        audioPath,
        metadata: {
          type: "debug_audio_capture",
          fileName: path.basename(audioPath),
          durationSeconds: index + 2,
          bytes: fixtureBytes[index].length,
        },
      }));

      snapshotSet = snapshotCaptures(pairs, path.join(outputRoot, "input.json"));
      snapshotRoot = snapshotSet.snapshotRoot;
      requireUniqueMeaningfulSnapshots(snapshotSet.snapshots);
      expect(snapshotSet.snapshots.map(({ audioFile }) => audioFile)).toEqual([
        "capture-001.webm",
        "capture-002.webm",
        "capture-003.webm",
      ]);
      expect(snapshotSet.snapshots.map(({ bytes }) => bytes)).toEqual([3, 5, 4]);
      expect(
        snapshotSet.snapshots.map((snapshot) => readValidatedSnapshot(snapshotSet!, snapshot))
      ).toEqual(fixtureBytes);
      expect(snapshotSet.snapshots.every(({ audioPath }) => !isInside(repoRoot, audioPath))).toBe(
        true
      );
    } finally {
      if (snapshotSet) releaseSnapshotHandles(snapshotSet);
      for (let index = 0; index < fixtureBytes.length; index += 1) {
        const snapshotPath = snapshotRoot && path.join(snapshotRoot, snapshotFileName(index));
        if (snapshotPath && fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
        if (fs.existsSync(sourcePaths[index])) fs.unlinkSync(sourcePaths[index]);
      }
      if (snapshotRoot && fs.existsSync(snapshotRoot)) fs.rmdirSync(snapshotRoot);
      if (fs.existsSync(sourceRoot)) fs.rmdirSync(sourceRoot);
      if (fs.existsSync(outputRoot)) fs.rmdirSync(outputRoot);
    }
  });

  it("removes copied files and the private directory when construction fails", () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-snapshot-failure-source-"));
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-snapshot-failure-output-"));
    const firstPath = path.join(sourceRoot, "first.webm");
    const changedPath = path.join(sourceRoot, "changed.webm");

    try {
      fs.writeFileSync(firstPath, Buffer.from([1, 2, 3]));
      fs.writeFileSync(changedPath, Buffer.from([4, 5, 6]));
      const pairs: CapturePair[] = [
        {
          audioPath: firstPath,
          metadata: {
            type: "debug_audio_capture",
            fileName: "first.webm",
            durationSeconds: 3,
            bytes: 3,
          },
        },
        {
          audioPath: changedPath,
          metadata: {
            type: "debug_audio_capture",
            fileName: "changed.webm",
            durationSeconds: 3,
            bytes: 4,
          },
        },
      ];

      expect(() => snapshotCaptures(pairs, path.join(outputRoot, "input.json"))).toThrow(
        "could not be completed and validated"
      );
      expect(fs.readdirSync(outputRoot)).toEqual([]);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("rejects a source pathname replaced immediately before its retained handle opens", () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-source-swap-"));
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-source-swap-output-"));
    const sourcePath = path.join(sourceRoot, "source.webm");
    const displacedPath = path.join(sourceRoot, "source-original.webm");
    const original = Buffer.from("authorized-audio", "utf8");
    const replacement = Buffer.from("substituted-audio", "utf8");
    fs.writeFileSync(sourcePath, original);
    const pair: CapturePair = {
      audioPath: sourcePath,
      metadata: {
        type: "debug_audio_capture",
        fileName: path.basename(sourcePath),
        durationSeconds: 3,
        bytes: original.length,
      },
      sourceIdentity: captureSourceIdentity(sourcePath, original.length),
    };
    const providerCall = vi.fn();
    const realOpenSync = fs.openSync.bind(fs);
    let swapped = false;
    vi.spyOn(fs, "openSync").mockImplementation(((target: fs.PathLike, flags: any, mode?: any) => {
      if (!swapped && path.resolve(String(target)) === path.resolve(sourcePath)) {
        swapped = true;
        fs.renameSync(sourcePath, displacedPath);
        fs.writeFileSync(sourcePath, replacement);
      }
      return realOpenSync(target, flags, mode);
    }) as typeof fs.openSync);

    try {
      expect(() => {
        snapshotCaptures([pair], path.join(outputRoot, "input.json"));
        providerCall();
      }).toThrow("could not be completed and validated");
      expect(swapped).toBe(true);
      expect(providerCall).not.toHaveBeenCalled();
      expect(fs.readdirSync(outputRoot)).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      fs.rmSync(sourceRoot, { recursive: true, force: true });
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it(
    "scrubs an opened destination when the snapshot root is swapped before its first write",
    () => {
      const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-root-swap-source-"));
      const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-root-swap-output-"));
      const sourcePath = path.join(sourceRoot, "source.webm");
      const marker = Buffer.from("PRIVATE_SNAPSHOT_ROOT_SWAP_MARKER", "utf8");
      fs.writeFileSync(sourcePath, marker);
      const pair: CapturePair = {
        audioPath: sourcePath,
        metadata: {
          type: "debug_audio_capture",
          fileName: path.basename(sourcePath),
          durationSeconds: 3,
          bytes: marker.length,
        },
        sourceIdentity: captureSourceIdentity(sourcePath, marker.length),
      };
      const providerCall = vi.fn();
      const realOpenSync = fs.openSync.bind(fs);
      let attempted = false;
      let swapped = false;
      let swapPreventedByOpenHandle = false;
      vi.spyOn(fs, "openSync").mockImplementation(
        ((target: fs.PathLike, flags: any, mode?: any) => {
          const targetPath = path.resolve(String(target));
          if (!attempted && path.basename(targetPath) === "capture-001.webm") {
            attempted = true;
            const snapshotRoot = path.dirname(targetPath);
            const displacedRoot = `${snapshotRoot}-displaced`;
            try {
              fs.renameSync(snapshotRoot, displacedRoot);
            } catch (error: any) {
              if (["EACCES", "EBUSY", "EPERM"].includes(error?.code)) {
                swapPreventedByOpenHandle = true;
              }
              throw error;
            }
            fs.mkdirSync(snapshotRoot);
            swapped = true;
          }
          return realOpenSync(target, flags, mode);
        }) as typeof fs.openSync
      );

      try {
        expect(() => {
          snapshotCaptures([pair], path.join(outputRoot, "input.json"));
          providerCall();
        }).toThrow("could not be completed and validated");
        expect(attempted).toBe(true);
        expect(swapped || swapPreventedByOpenHandle).toBe(true);
        expect(providerCall).not.toHaveBeenCalled();

        const pending = [outputRoot];
        while (pending.length > 0) {
          const directory = pending.pop()!;
          for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const candidate = path.join(directory, entry.name);
            if (entry.isDirectory()) pending.push(candidate);
            else if (entry.isFile()) {
              const residual = fs.readFileSync(candidate);
              expect(residual.includes(marker)).toBe(false);
              expect(residual.length).toBe(0);
            }
          }
        }
      } finally {
        vi.restoreAllMocks();
        fs.rmSync(sourceRoot, { recursive: true, force: true });
        fs.rmSync(outputRoot, { recursive: true, force: true });
      }
    },
    60_000
  );

  it.each(["credential", "transcription", "validation", "output"])(
    "removes a completed snapshot when later %s work fails",
    async (stage) => {
      const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-snapshot-lifecycle-"));
      const snapshotRoot = fs.mkdtempSync(path.join(outputRoot, "echodraft-real-audio-"));
      const outputPath = path.join(outputRoot, "input.json");
      fs.writeFileSync(path.join(snapshotRoot, "capture-001.webm"), Buffer.from([1, 2, 3]));
      const snapshotSet = retainExistingSnapshotSet(snapshotRoot);

      try {
        await expect(
          runWithSnapshotRetention(snapshotSet, async () => {
            throw new Error(`${stage} failure`);
          })
        ).rejects.toThrow(`${stage} failure`);
        expect(fs.existsSync(snapshotRoot)).toBe(false);
      } finally {
        if (fs.existsSync(outputRoot)) fs.rmdirSync(outputRoot);
      }
    }
  );

  it("retains a completed snapshot only after all later work succeeds", async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-snapshot-retained-"));
    const snapshotRoot = fs.mkdtempSync(path.join(outputRoot, "echodraft-real-audio-"));
    const capturePath = path.join(snapshotRoot, "capture-001.webm");
    fs.writeFileSync(capturePath, Buffer.from([1, 2, 3]));
    const snapshotSet = retainExistingSnapshotSet(snapshotRoot);

    try {
      await expect(runWithSnapshotRetention(snapshotSet, async () => "complete")).resolves.toBe(
        "complete"
      );
      expect(fs.existsSync(capturePath)).toBe(true);
    } finally {
      if (fs.existsSync(capturePath)) fs.unlinkSync(capturePath);
      if (fs.existsSync(snapshotRoot)) fs.rmdirSync(snapshotRoot);
      if (fs.existsSync(outputRoot)) fs.rmdirSync(outputRoot);
    }
  });

  it(
    "scrubs the retained file and preserves a replacement swapped in after cleanup verification",
    () => {
      const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-cleanup-swap-"));
      const snapshotRoot = fs.mkdtempSync(path.join(outputRoot, "echodraft-real-audio-"));
      const capturePath = path.join(snapshotRoot, "capture-001.webm");
      const displacedPath = path.join(snapshotRoot, "displaced.webm");
      const privateMarker = Buffer.from("PRIVATE_CLEANUP_MARKER", "utf8");
      const replacementMarker = Buffer.from("replacement-owned-by-another-writer", "utf8");
      fs.writeFileSync(capturePath, privateMarker);
      const snapshotSet = retainExistingSnapshotSet(snapshotRoot);
      let swapped = false;

      try {
        expect(() =>
          removeFailedSnapshot(snapshotSet, {
            beforeDeleteSnapshot: (snapshot) => {
              if (swapped || snapshot.audioPath !== capturePath) return;
              fs.renameSync(capturePath, displacedPath);
              fs.writeFileSync(capturePath, replacementMarker);
              swapped = true;
            },
          })
        ).toThrow(/identity|safely|changed/i);
        expect(swapped).toBe(true);
        expect(fs.readFileSync(capturePath)).toEqual(replacementMarker);
        expect(fs.statSync(displacedPath).size).toBe(0);
      } finally {
        releaseSnapshotHandles(snapshotSet);
        fs.rmSync(outputRoot, { recursive: true, force: true });
      }
    },
    60_000
  );

  it("rejects a retained snapshot pathname replaced with identical bytes", () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-snapshot-replaced-"));
    const snapshotRoot = fs.mkdtempSync(path.join(outputRoot, "echodraft-real-audio-"));
    const capturePath = path.join(snapshotRoot, "capture-001.webm");
    const displacedPath = path.join(snapshotRoot, "displaced.webm");
    fs.writeFileSync(capturePath, Buffer.from([1, 2, 3]));
    const snapshotSet = retainExistingSnapshotSet(snapshotRoot);

    try {
      fs.renameSync(capturePath, displacedPath);
      fs.writeFileSync(capturePath, Buffer.from([1, 2, 3]));
      expect(() => readValidatedSnapshot(snapshotSet, snapshotSet.snapshots[0])).toThrow(
        "identity changed"
      );
    } finally {
      releaseSnapshotHandles(snapshotSet);
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("removes an exclusive partial JSON temp when its writer throws", () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-output-partial-"));
    const outputPath = path.join(outputRoot, "input.json");
    const parentIdentity = capturePathIdentity(outputRoot, "directory");
    try {
      expect(() =>
        publishJsonAtomically(
          outputPath,
          { transcript: "private marker" },
          parentIdentity,
          (fd) => {
            fs.writeSync(fd, Buffer.from('{"transcript":"partial'));
            throw new Error("injected write failure");
          }
        )
      ).toThrow("injected write failure");
      expect(fs.readdirSync(outputRoot)).toEqual([]);
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("publishes complete JSON without retaining its exclusive temporary file", () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-output-complete-"));
    const outputPath = path.join(outputRoot, "input.json");
    try {
      publishJsonAtomically(
        outputPath,
        { schemaVersion: 2, transcript: "synthetic text" },
        capturePathIdentity(outputRoot, "directory")
      );
      expect(JSON.parse(fs.readFileSync(outputPath, "utf8"))).toEqual({
        schemaVersion: 2,
        transcript: "synthetic text",
      });
      expect(fs.readdirSync(outputRoot)).toEqual(["input.json"]);
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when the output parent pathname is replaced before publication", () => {
    const parentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-output-parent-"));
    const outputRoot = path.join(parentRoot, "output");
    const displacedRoot = path.join(parentRoot, "displaced");
    fs.mkdirSync(outputRoot);
    const parentIdentity = capturePathIdentity(outputRoot, "directory");
    fs.renameSync(outputRoot, displacedRoot);
    fs.mkdirSync(outputRoot);

    try {
      expect(() =>
        publishJsonAtomically(path.join(outputRoot, "input.json"), { safe: true }, parentIdentity)
      ).toThrow("identity changed");
      expect(fs.readdirSync(outputRoot)).toEqual([]);
      expect(fs.readdirSync(displacedRoot)).toEqual([]);
    } finally {
      fs.rmSync(parentRoot, { recursive: true, force: true });
    }
  });
});

describe("selected real-audio environment", () => {
  it("uses only the explicitly parsed env file", () => {
    const envRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-selected-env-"));
    const envPath = path.join(envRoot, "selected.env");
    const previous = process.env.OPENAI_API_KEY;
    try {
      process.env.OPENAI_API_KEY = "ambient-must-not-win";
      fs.writeFileSync(envPath, "OPENAI_API_KEY=selected-only\n", { mode: 0o600 });
      expect(parseSelectedEnvironment(envPath).OPENAI_API_KEY).toBe("selected-only");
      expect(process.env.OPENAI_API_KEY).toBe("ambient-must-not-win");
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
      fs.rmSync(envRoot, { recursive: true, force: true });
    }
  });

  it("rejects traversal and non-canonical path aliases", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-canonical-path-"));
    try {
      expect(() =>
        requireCanonicalPath(
          { TARGET: `${root}${path.sep}child${path.sep}..${path.sep}value.json` },
          "TARGET",
          {
            mustExist: false,
            extension: ".json",
          }
        )
      ).toThrow("canonical path");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects fewer than three unique meaningful synthetic recordings", () => {
    expect(() =>
      requireUniqueMeaningfulSnapshots(
        ["one", "two", "three"].map(() => ({ durationSeconds: 3, sha256: "same-digest" }))
      )
    ).toThrow("three unique meaningful recordings");
  });
});

describe("build authorized real-audio evaluation input", () => {
  liveIt(
    "transcribes paired debug captures into a private evaluation input",
    async () => {
      const envSelector = process.env.ECHODRAFT_REAL_AUDIO_ENV?.trim() || "";
      if (!envSelector) throw new Error("ECHODRAFT_REAL_AUDIO_ENV is unavailable.");
      if (!path.isAbsolute(envSelector) || path.normalize(envSelector) !== envSelector) {
        throw new Error("ECHODRAFT_REAL_AUDIO_ENV must be an absolute canonical path.");
      }
      const envPath = fs.realpathSync(envSelector);
      if (envPath !== envSelector || !fs.statSync(envPath).isFile()) {
        throw new Error("The configured environment file must be a canonical regular file.");
      }
      if (isInside(repoRoot, envPath)) {
        throw new Error("The configured environment file must be outside the repository.");
      }
      const environment = parseSelectedEnvironment(envPath);
      const audioRoot = requireCanonicalPath(environment, "ECHODRAFT_REAL_AUDIO_ROOT", {
        mustExist: true,
      });
      const outputPath = requireCanonicalPath(environment, "ECHODRAFT_REAL_AUDIO_EVAL_INPUT", {
        mustExist: false,
        extension: ".json",
      });
      if (
        isInside(repoRoot, audioRoot) ||
        isInside(repoRoot, resolveThroughExistingParent(outputPath))
      ) {
        throw new Error("The private evaluation input must be written outside the repository.");
      }
      if (fs.existsSync(outputPath)) {
        throw new Error("The private evaluation input path already exists.");
      }

      const pairs = loadCapturePairs(audioRoot);
      const snapshotSet = snapshotCaptures(pairs, outputPath);
      const { snapshots } = snapshotSet;
      await runWithSnapshotRetention(snapshotSet, async () => {
        requireUniqueMeaningfulSnapshots(snapshots);
        expect(snapshots).toHaveLength(pairs.length);
        expect(snapshots.every(({ audioFile }) => /^capture-\d{3}\.webm$/.test(audioFile))).toBe(
          true
        );
        const apiKey = requireEnvironmentValue(environment, "OPENAI_API_KEY");
        if (!apiKey) throw new Error("OPENAI_API_KEY is unavailable for the live transcription.");

        const storage = new MemoryStorage();
        Object.defineProperty(globalThis, "localStorage", {
          value: storage,
          configurable: true,
        });
        Object.defineProperty(globalThis, "window", {
          value: { localStorage: storage, electronAPI: createSecureProviderTestBridge(apiKey) },
          configurable: true,
        });
        localStorage.setItem("cloudTranscriptionProvider", "openai");
        localStorage.setItem("cloudTranscriptionModel", "gpt-4o-transcribe");
        localStorage.setItem("preferredLanguage", "en");
        localStorage.setItem("allowLocalFallback", "false");

        const transcriber = new OpenAiTranscriber({ logger: noContentLogger });
        const cases = [];
        for (const snapshot of snapshots) {
          const bytes = readValidatedSnapshot(snapshotSet, snapshot);
          const audio = new Blob([new Uint8Array(bytes)], { type: "audio/webm" });
          const result = await transcriber.processWithOpenAIAPI(audio, {
            durationSeconds: snapshot.durationSeconds,
          });
          cases.push({
            audioPath: snapshot.audioPath,
            audioFile: snapshot.audioFile,
            durationSeconds: snapshot.durationSeconds,
            freshTranscriptions: {
              "gpt-4o-transcribe": { text: result.rawText },
            },
          });
        }

        const meaningfulTexts = new Set(
          cases
            .map((item) => item.freshTranscriptions["gpt-4o-transcribe"].text.trim())
            .filter((text) => wordsForUniqueness(text).length >= 3)
            .map((text) => wordsForUniqueness(text).join(" "))
        );
        if (meaningfulTexts.size < 3) {
          throw new Error("At least three unique meaningful recordings are required.");
        }
        const hasSilenceCoverage = cases.some(
          (item) =>
            item.durationSeconds >= 30 &&
            wordsForUniqueness(item.freshTranscriptions["gpt-4o-transcribe"].text).length < 3
        );
        const silenceWaiver = environment.ECHODRAFT_REAL_AUDIO_SILENCE_WAIVER || "";
        if (!hasSilenceCoverage && !silenceWaiver) {
          throw new Error("Silence coverage or ECHODRAFT_REAL_AUDIO_SILENCE_WAIVER is required.");
        }

        validateSnapshotsBeforePublication(snapshotSet);
        publishJsonAtomically(
          outputPath,
          {
            schemaVersion: 2,
            privacy:
              "Contains user-authorized private voice transcripts; keep outside the repository.",
            generatedAt: new Date().toISOString(),
            snapshotRoot: path.dirname(snapshots[0].audioPath),
            silenceCoverage: hasSilenceCoverage
              ? { recorded: true, waiver: null }
              : { recorded: false, waiver: silenceWaiver },
            cases,
          },
          snapshotSet.outputParentIdentity
        );
      });
    },
    600_000
  );
});

const wordsForUniqueness = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
