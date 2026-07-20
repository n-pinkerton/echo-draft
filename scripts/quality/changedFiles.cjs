const { execFileSync } = require("node:child_process");

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function runGit(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveDefaultBase(root, defaultBaseRef, reason, diagnostic) {
  try {
    const mergeBase = runGit(root, ["merge-base", "HEAD", defaultBaseRef]).trim();
    if (mergeBase) {
      diagnostic(`Quality base ${reason}; using merge-base with ${defaultBaseRef}`);
      return mergeBase;
    }
  } catch {
    // Fall through for an orphan history or a checkout without its default branch.
  }
  diagnostic(`Quality base ${reason}; using empty tree because default history is unavailable`);
  return EMPTY_TREE;
}

function resolveBase(
  root,
  requestedBase,
  defaultBaseRef = process.env.QUALITY_DEFAULT_BASE_REF || "origin/main",
  diagnostic = console.warn
) {
  const candidate = String(requestedBase || "").trim();
  if (/^0+$/.test(candidate)) {
    return resolveDefaultBase(root, defaultBaseRef, "is the zero SHA", diagnostic);
  }
  if (candidate) {
    try {
      runGit(root, ["rev-parse", "--verify", `${candidate}^{commit}`]);
      return candidate;
    } catch {
      return resolveDefaultBase(root, defaultBaseRef, `${candidate} is unavailable`, diagnostic);
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
  const tracked = runGit(root, ["diff", "--name-only", "-z", "--diff-filter=ACMRTUXB", base, "--"]);
  const untracked = runGit(root, ["ls-files", "-z", "--others", "--exclude-standard"]);
  return {
    base,
    files: [...tracked.split("\0"), ...untracked.split("\0")]
      .filter(Boolean)
      .filter((filePath, index, all) => all.indexOf(filePath) === index),
  };
}

module.exports = { changedFiles, resolveBase, EMPTY_TREE };
