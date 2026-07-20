const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { changedFiles } = require("./changedFiles.cjs");

const root = process.cwd();
const eslintCli = path.join(root, "node_modules", "eslint", "bin", "eslint.js");
const { files } = changedFiles(root, process.env.QUALITY_BASE_SHA);
const productionFiles = files.filter((filePath) =>
  /\.(?:js|jsx|ts|tsx|cjs|mjs)$/.test(filePath) &&
  !/\.test\.[^.]+$/.test(filePath) &&
  !filePath.includes("/dist/") &&
  !filePath.startsWith("dist/")
);
const rootFiles = productionFiles.filter((filePath) => !filePath.startsWith("src/"));
const srcFiles = productionFiles.filter((filePath) => filePath.startsWith("src/")).map((filePath) => filePath.slice(4));
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

const run = (cwd, files, extraRules = []) => {
  if (!files.length) return;
  execFileSync(process.execPath, [eslintCli, ...files, ...[...rules, ...extraRules].flatMap((rule) => ["--rule", rule])], {
    cwd,
    stdio: "inherit",
  });
};

run(root, rootFiles);
run(path.join(root, "src"), srcFiles, ["react-hooks/rules-of-hooks:error"]);
