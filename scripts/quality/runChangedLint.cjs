const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { changedFiles } = require("./changedFiles.cjs");

const rules = [
  "no-duplicate-case:error",
  "no-dupe-keys:error",
  "no-unsafe-finally:error",
  "no-unreachable-loop:error",
  "no-promise-executor-return:error",
  "no-async-promise-executor:error",
  "no-return-await:error",
  "require-yield:error",
];

const isProductionFile = (filePath) =>
  /\.(?:js|jsx|ts|tsx|cjs|mjs)$/.test(filePath) &&
  !/\.test\.[^.]+$/.test(filePath) &&
  !filePath.includes("/dist/") &&
  !filePath.startsWith("dist/");

const classifyChangedLintFiles = (files) => {
  const productionFiles = files.filter(isProductionFile);
  const rootFiles = productionFiles.filter((filePath) => !filePath.startsWith("src/"));
  const srcFiles = productionFiles
    .filter((filePath) => filePath.startsWith("src/"))
    .map((filePath) => filePath.slice(4));
  return {
    rootFiles,
    srcCoreFiles: srcFiles.filter((filePath) => /\.(?:cjs|mjs)$/.test(filePath)),
    srcReactFiles: srcFiles.filter((filePath) => /\.(?:js|jsx|ts|tsx)$/.test(filePath)),
  };
};

const runGroup = (execFile, eslintCli, cwd, files, extraRules = []) => {
  if (!files.length) return;
  execFile(
    process.execPath,
    [eslintCli, ...[...rules, ...extraRules].flatMap((rule) => ["--rule", rule]), "--", ...files],
    {
      cwd,
      stdio: "inherit",
    }
  );
};

function runChangedLint({
  root = process.cwd(),
  requestedBase = process.env.QUALITY_BASE_SHA,
  getChangedFiles = changedFiles,
  execFile = execFileSync,
} = {}) {
  const eslintCli = path.join(root, "node_modules", "eslint", "bin", "eslint.js");
  const { files } = getChangedFiles(root, requestedBase);
  const { rootFiles, srcCoreFiles, srcReactFiles } = classifyChangedLintFiles(files);
  runGroup(execFile, eslintCli, root, rootFiles);
  runGroup(execFile, eslintCli, path.join(root, "src"), srcCoreFiles);
  runGroup(execFile, eslintCli, path.join(root, "src"), srcReactFiles, [
    "react-hooks/rules-of-hooks:error",
  ]);
}

if (require.main === module) runChangedLint();

module.exports = { classifyChangedLintFiles, runChangedLint };
