const DEFAULT_READ_CHUNK_BYTES = 4 * 1024 * 1024;

const sameFileIdentity = (left, right) =>
  Boolean(
    left &&
    right &&
    Number.isFinite(left.dev) &&
    Number.isFinite(left.ino) &&
    left.dev === right.dev &&
    left.ino === right.ino
  );

const sameStableFile = (left, right) =>
  Boolean(
    sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.mode === right.mode
  );

async function readStablePathStats(fs, filePath) {
  const before = await fs.promises.lstat(filePath);
  const after = await fs.promises.lstat(filePath);
  if (!sameStableFile(before, after)) {
    throw new Error("File path changed while it was being inspected");
  }
  return before;
}

async function readFileHandleBounded(
  fileHandle,
  expectedSize,
  { maxBytes, chunkBytes = DEFAULT_READ_CHUNK_BYTES } = {}
) {
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 1 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    expectedSize > maxBytes ||
    !Number.isSafeInteger(chunkBytes) ||
    chunkBytes < 1
  ) {
    throw new Error("File size is invalid");
  }

  const chunks = [];
  let totalBytes = 0;
  while (totalBytes < expectedSize) {
    const requestedBytes = Math.min(chunkBytes, expectedSize - totalBytes);
    const chunk = Buffer.allocUnsafe(requestedBytes);
    // eslint-disable-next-line no-await-in-loop
    const { bytesRead } = await fileHandle.read(chunk, 0, requestedBytes, null);
    if (bytesRead <= 0) break;
    totalBytes += bytesRead;
    if (totalBytes > maxBytes) throw new Error("File exceeds the size limit");
    chunks.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
  }
  if (totalBytes !== expectedSize) throw new Error("File changed while it was being read");
  return Buffer.concat(chunks, totalBytes);
}

async function readStableRegularFile(
  fs,
  filePath,
  { maxBytes, minBytes = 1, rejectSymbolicLinks = false } = {}
) {
  const pathBefore = rejectSymbolicLinks ? await fs.promises.lstat(filePath) : null;
  if (pathBefore && (!pathBefore.isFile() || pathBefore.isSymbolicLink())) {
    throw new Error("File path must be a regular file");
  }

  const fileHandle = await fs.promises.open(filePath, "r");
  try {
    const before = await fileHandle.stat();
    if (
      !before.isFile() ||
      !Number.isSafeInteger(before.size) ||
      before.size < minBytes ||
      before.size > maxBytes
    ) {
      throw new Error("File is empty, invalid, or too large");
    }
    if (pathBefore && !sameFileIdentity(pathBefore, before)) {
      throw new Error("File changed before it was read");
    }

    const buffer = await readFileHandleBounded(fileHandle, before.size, { maxBytes });
    const after = await fileHandle.stat();
    const pathAfter = rejectSymbolicLinks
      ? await fs.promises.lstat(filePath)
      : await fs.promises.stat(filePath);
    if (
      !after.isFile() ||
      !pathAfter.isFile() ||
      (rejectSymbolicLinks && pathAfter.isSymbolicLink()) ||
      !sameFileIdentity(before, after) ||
      !sameFileIdentity(before, pathAfter) ||
      after.size !== before.size ||
      pathAfter.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      pathAfter.mtimeMs !== before.mtimeMs ||
      pathAfter.ctimeMs !== before.ctimeMs
    ) {
      throw new Error("File changed while it was being read");
    }
    return { buffer, stats: before };
  } finally {
    await fileHandle.close();
  }
}

module.exports = {
  readFileHandleBounded,
  readStablePathStats,
  readStableRegularFile,
  sameFileIdentity,
  sameStableFile,
};
