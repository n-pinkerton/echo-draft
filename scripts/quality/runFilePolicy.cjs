const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { changedFiles } = require("./changedFiles.cjs");
const {
  evaluateFilePolicy,
  isSupportedSourceFile,
  logicalLineCount,
  MAX_SUPPORTED_SOURCE_BYTES,
} = require("./filePolicy.js");

const SOURCE_BUFFER_MARGIN_BYTES = 64 * 1024;

function parseRenameSources(output) {
  const records = output.split("\0");
  if (records.at(-1) === "") records.pop();
  const renameSources = new Map();
  for (let index = 0; index < records.length; ) {
    const status = records[index++];
    if (!status) throw new Error("Malformed NUL-delimited Git name-status output");
    const source = records[index++];
    if (source === undefined) throw new Error("Malformed NUL-delimited Git name-status output");
    if (status.startsWith("R") || status.startsWith("C")) {
      const destination = records[index++];
      if (destination === undefined)
        throw new Error("Malformed NUL-delimited Git name-status output");
      if (status.startsWith("R")) renameSources.set(destination, source);
    }
  }
  return renameSources;
}

function inspectBaseFile({ root, base, previousPath, execFile, maxSourceBytes }) {
  const maxBuffer = maxSourceBytes + SOURCE_BUFFER_MARGIN_BYTES;
  const listing = execFile(
    "git",
    ["--literal-pathspecs", "ls-tree", "-z", "-l", base, "--", previousPath],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer,
    }
  );
  if (!listing) return { exists: false, source: null };

  const records = listing.split("\0");
  if (records.length !== 2 || records[1] !== "")
    throw new Error(`Unexpected base tree result for ${previousPath}`);
  const separator = records[0].indexOf("\t");
  if (separator < 0) throw new Error(`Malformed base tree result for ${previousPath}`);
  const metadata = records[0].slice(0, separator);
  const listedPath = records[0].slice(separator + 1);
  const match = metadata.match(/^\d+ blob ([0-9a-f]+)\s+(\d+)$/i);
  if (!match || listedPath !== previousPath)
    throw new Error(`Unexpected base tree result for ${previousPath}`);

  const [, objectId, sizeText] = match;
  const byteSize = Number(sizeText);
  if (!Number.isSafeInteger(byteSize))
    throw new Error(`Invalid base blob size for ${previousPath}`);
  if (byteSize > maxSourceBytes) return { exists: true, source: null, oversized: true, byteSize };

  const source = execFile("git", ["show", objectId], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer,
  });
  return { exists: true, source, oversized: false, byteSize };
}

function inspectChangedFile({
  root,
  relativePath,
  base,
  previousPath = relativePath,
  exempt = false,
  fsApi = fs,
  execFile = execFileSync,
  maxSourceBytes = MAX_SUPPORTED_SOURCE_BYTES,
}) {
  if (!isSupportedSourceFile(relativePath)) return [];

  const absolutePath = path.join(root, relativePath);
  let fileStats;
  try {
    fileStats = fsApi.lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) return [];
  if (fileStats.size > maxSourceBytes) {
    return [
      {
        level: "error",
        code: "supported-source-too-large",
        filePath: relativePath,
        byteSize: fileStats.size,
      },
    ];
  }

  const source = fsApi.readFileSync(absolutePath, "utf8");
  const currentLines = logicalLineCount(source);
  const baseFile = inspectBaseFile({ root, base, previousPath, execFile, maxSourceBytes });
  const previousLines = baseFile.source === null ? null : logicalLineCount(baseFile.source);
  const findings = evaluateFilePolicy({
    filePath: relativePath,
    logicalLines: currentLines,
    previousLogicalLines: previousLines,
    isNew: !baseFile.exists,
    exempt,
  }).map((finding) => ({ ...finding, filePath: relativePath, logicalLines: currentLines }));
  if (baseFile.oversized) {
    findings.unshift({
      level: "warn",
      code: "base-source-too-large",
      filePath: relativePath,
      byteSize: baseFile.byteSize,
    });
  }
  return findings;
}

function runFilePolicy({
  root = process.cwd(),
  requestedBase = process.env.QUALITY_BASE_SHA,
  getChangedFiles = changedFiles,
  fsApi = fs,
  execFile = execFileSync,
  log = console.log,
  maxSourceBytes = MAX_SUPPORTED_SOURCE_BYTES,
} = {}) {
  const { base, files } = getChangedFiles(root, requestedBase);
  const exemptionPath = path.join(root, "scripts", "quality", "file-policy-exemptions.json");
  const exemptions = fsApi.existsSync(exemptionPath)
    ? JSON.parse(fsApi.readFileSync(exemptionPath, "utf8"))
    : {};
  const findings = [];
  const renameOutput = execFile("git", ["diff", "--name-status", "-z", "-M", base, "--"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: maxSourceBytes + SOURCE_BUFFER_MARGIN_BYTES,
  });
  const renameSources = parseRenameSources(renameOutput);

  for (const [relativePath, exemption] of Object.entries(exemptions)) {
    if (
      !exemption ||
      typeof exemption !== "object" ||
      typeof exemption.reason !== "string" ||
      !exemption.reason.trim()
    ) {
      findings.push({
        level: "error",
        code: "invalid-file-policy-exemption",
        filePath: relativePath,
      });
    }
  }

  for (const relativePath of files) {
    const normalizedPath = relativePath.replaceAll("\\", "/");
    findings.push(
      ...inspectChangedFile({
        root,
        relativePath,
        base,
        previousPath: renameSources.get(normalizedPath) || relativePath,
        exempt: Object.prototype.hasOwnProperty.call(exemptions, normalizedPath),
        fsApi,
        execFile,
        maxSourceBytes,
      })
    );
  }

  for (const finding of findings) {
    const detail =
      finding.byteSize === undefined
        ? `${finding.logicalLines} logical lines`
        : `${finding.byteSize} bytes`;
    log(`${finding.level.toUpperCase()} ${finding.code} ${finding.filePath} (${detail})`);
  }
  return findings;
}

function main() {
  const findings = runFilePolicy();
  if (findings.some(({ level }) => level === "error")) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { inspectBaseFile, inspectChangedFile, parseRenameSources, runFilePolicy };
