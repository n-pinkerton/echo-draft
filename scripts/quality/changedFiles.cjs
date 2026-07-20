const { execFileSync } = require("node:child_process");

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function runGit(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function resolveBase(root, requestedBase) {
  const candidate = String(requestedBase || "").trim();
  if (/^0+$/.test(candidate)) return EMPTY_TREE;
  if (candidate) {
    try {
      runGit(root, ["rev-parse", "--verify", `${candidate}^{commit}`]);
      return candidate;
    } catch {
      throw new Error(`Quality base ${candidate} is not available in the checkout`);
    }
  }

  try {
    runGit(root, ["rev-parse", "--verify", "HEAD~1^{commit}"]);
    return "HEAD~1";
  } catch {
    return EMPTY_TREE;
  }
}

function changedFiles(root, requestedBase) {
  const base = resolveBase(root, requestedBase);
  const tracked = runGit(root, [
    "diff",
    "--name-only",
    "--diff-filter=ACMRTUXB",
    base,
    "--",
  ]);
  const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"]);
  return {
    base,
    files: [...tracked.split(/\r?\n/), ...untracked.split(/\r?\n/)]
      .map((filePath) => filePath.trim())
      .filter(Boolean)
      .filter((filePath, index, all) => all.indexOf(filePath) === index),
  };
}

module.exports = { changedFiles, resolveBase };
