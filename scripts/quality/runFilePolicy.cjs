const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { changedFiles } = require("./changedFiles.cjs");
const { evaluateFilePolicy, logicalLineCount } = require("./filePolicy.js");

const root = process.cwd();
const { base, files } = changedFiles(root, process.env.QUALITY_BASE_SHA);
const exemptionPath = path.join(root, "scripts", "quality", "file-policy-exemptions.json");
const exemptions = fs.existsSync(exemptionPath) ? JSON.parse(fs.readFileSync(exemptionPath, "utf8")) : {};
const findings = [];
const renameSources = new Map();
try {
  for (const line of execFileSync("git", ["diff", "--name-status", "-M", base, "--"], { cwd: root, encoding: "utf8" }).split(/\r?\n/)) {
    const [status, source, destination] = line.split("\t");
    if (status?.startsWith("R") && source && destination) renameSources.set(destination, source);
  }
} catch {
  // A local working-tree comparison can still evaluate files without rename metadata.
}

for (const [relativePath, exemption] of Object.entries(exemptions)) {
  if (!exemption || typeof exemption !== "object" || typeof exemption.reason !== "string" || !exemption.reason.trim()) {
    findings.push({ level: "error", code: "invalid-file-policy-exemption", filePath: relativePath });
  }
}

for (const relativePath of files) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
  const source = fs.readFileSync(absolutePath, "utf8");
  const currentLines = logicalLineCount(source);
  let previousLines = null;
  try {
    const previousPath = renameSources.get(relativePath.replaceAll("\\", "/")) || relativePath;
    const previous = execFileSync("git", ["show", base + ":" + previousPath], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    previousLines = logicalLineCount(previous);
  } catch {
    // A missing base path means this is a new file.
  }
  findings.push(...evaluateFilePolicy({
    filePath: relativePath,
    logicalLines: currentLines,
    previousLogicalLines: previousLines,
    isNew: previousLines === null,
    exempt: Object.prototype.hasOwnProperty.call(exemptions, relativePath.replaceAll("\\", "/")),
  }).map((finding) => ({ ...finding, filePath: relativePath, logicalLines: currentLines })));
}

for (const finding of findings) {
  console.log(finding.level.toUpperCase() + " " + finding.code + " " + finding.filePath + " (" + finding.logicalLines + " logical lines)");
}

if (findings.some(({ level }) => level === "error")) process.exitCode = 1;
