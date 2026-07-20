const path = require("node:path");

const PRODUCTION_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs"]);

const isTestFile = (filePath) => /(^|[\\/])[^\\/]+\.test\.[^.]+$/.test(filePath);

const isHandwrittenProductionFile = (filePath) => {
  const normalized = filePath.replaceAll("\\", "/");
  return (
    PRODUCTION_EXTENSIONS.has(path.extname(normalized)) &&
    !isTestFile(normalized) &&
    !normalized.includes("/dist/") &&
    !normalized.startsWith("dist/") &&
    !normalized.includes("/generated/")
  );
};

const logicalLineCount = (source) => {
  let state = "code";
  let stringDelimiter = null;
  let escaped = false;
  let hasCode = false;
  let count = 0;

  const finishLine = () => {
    if (hasCode) count += 1;
    hasCode = false;
    if (state === "lineComment") state = "code";
  };

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (current === "\n") {
      finishLine();
      continue;
    }
    if (current === "\r") continue;
    if (state === "lineComment") continue;
    if (state === "blockComment") {
      if (current === "*" && next === "/") {
        state = "code";
        index += 1;
      }
      continue;
    }
    if (state === "string" || state === "template") {
      hasCode = true;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if ((state === "string" && current === stringDelimiter) || (state === "template" && current === "`")) {
        state = "code";
        stringDelimiter = null;
      }
      continue;
    }
    if (current === "/" && next === "/") {
      state = "lineComment";
      index += 1;
    } else if (current === "/" && next === "*") {
      state = "blockComment";
      index += 1;
    } else if (current === '"' || current === "'" || current === "`") {
      state = current === "`" ? "template" : "string";
      stringDelimiter = state === "string" ? current : null;
      hasCode = true;
    } else if (!/\s/.test(current)) {
      hasCode = true;
    }
  }
  finishLine();
  return count;
};

const evaluateFilePolicy = ({ filePath, logicalLines, isNew, previousLogicalLines = null, exempt = false }) => {
  const normalized = filePath.replaceAll("\\", "/");
  const isSupportedSourceFile =
    PRODUCTION_EXTENSIONS.has(path.extname(normalized)) &&
    !normalized.includes("/dist/") &&
    !normalized.startsWith("dist/") &&
    !normalized.includes("/generated/");
  if (exempt || !isSupportedSourceFile) return [];

  const findings = [];
  if (isTestFile(normalized)) {
    if (logicalLines > 1200) findings.push({ level: "warn", code: "test-file-size" });
    return findings;
  }

  if (isNew) {
    if (logicalLines > 500) findings.push({ level: "error", code: "new-production-file-size" });
    else if (logicalLines > 350) findings.push({ level: "warn", code: "new-production-file-size" });
  } else if (logicalLines > 500 && previousLogicalLines !== null && logicalLines > previousLogicalLines) {
    findings.push({ level: "warn", code: "grandfathered-file-growth" });
  }
  return findings;
};

module.exports = { evaluateFilePolicy, isHandwrittenProductionFile, isTestFile, logicalLineCount };
