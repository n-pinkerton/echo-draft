const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const RENDERER_EXTERNAL_MODULES = require("../../src/config/rendererExternalModules.cjs");
const DEFAULT_ASSETS_DIRECTORY = path.resolve(__dirname, "../../src/dist/assets");
const ANALYSIS_FILE_NAME = "/renderer-bundle.js";

function collectJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

function createSourceAnalysis(source) {
  const compilerOptions = {
    allowJs: true,
    checkJs: false,
    module: ts.ModuleKind.ESNext,
    noLib: true,
    target: ts.ScriptTarget.Latest,
    types: [],
  };
  const sourceFile = ts.createSourceFile(
    ANALYSIS_FILE_NAME,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const host = {
    fileExists: (fileName) => fileName === ANALYSIS_FILE_NAME,
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => "/",
    getDefaultLibFileName: () => "",
    getDirectories: () => [],
    getNewLine: () => "\n",
    getSourceFile: (fileName) => (fileName === ANALYSIS_FILE_NAME ? sourceFile : undefined),
    readFile: (fileName) => (fileName === ANALYSIS_FILE_NAME ? source : undefined),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => {},
  };
  const program = ts.createProgram({
    rootNames: [ANALYSIS_FILE_NAME],
    options: compilerOptions,
    host,
  });
  return {
    checker: program.getTypeChecker(),
    sourceFile: program.getSourceFile(ANALYSIS_FILE_NAME),
  };
}

function isNonReferencePropertyName(node) {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isGetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isSetAccessorDeclaration(parent) && parent.name === node)
  );
}

function getRootIdentifier(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
    while (ts.isParenthesizedExpression(current)) current = current.expression;
  }
  return ts.isIdentifier(current) ? current : null;
}

function isLocallyBoundIdentifier(node, checker, sourceFile) {
  const symbol = checker.getSymbolAtLocation(node);
  return Boolean(
    symbol?.declarations?.some((declaration) => declaration.getSourceFile() === sourceFile)
  );
}

function findCommonJsRequireReferences(source) {
  const matches = new Set();
  const { checker, sourceFile } = createSourceAnalysis(source);
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      node.text === "require" &&
      !isNonReferencePropertyName(node) &&
      !isLocallyBoundIdentifier(node, checker, sourceFile)
    ) {
      matches.add(node.getStart(sourceFile));
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "require" &&
      (() => {
        const root = getRootIdentifier(node.expression);
        return root && !isLocallyBoundIdentifier(root, checker, sourceFile);
      })()
    ) {
      matches.add(node.name.getStart(sourceFile));
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "require" &&
      (() => {
        const root = getRootIdentifier(node.expression);
        return root && !isLocallyBoundIdentifier(root, checker, sourceFile);
      })()
    ) {
      matches.add(node.argumentExpression.getStart(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...matches].sort((left, right) => left - right);
}

function isBareModuleSpecifier(specifier) {
  return (
    !specifier.startsWith("./") &&
    !specifier.startsWith("../") &&
    !specifier.startsWith("/") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(specifier)
  );
}

function isConfiguredRendererExternal(specifier) {
  const normalized = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  return RENDERER_EXTERNAL_MODULES.some(
    (external) => normalized === external || normalized.startsWith(`${external}/`)
  );
}

function findBrowserIncompatibleModuleSpecifiers(source) {
  const sourceFile = ts.createSourceFile(
    ANALYSIS_FILE_NAME,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const matches = [];
  const addSpecifier = (literal) => {
    const specifier = literal?.text;
    if (typeof specifier !== "string") return;
    if (
      !specifier.startsWith("node:") &&
      !isBareModuleSpecifier(specifier) &&
      !isConfiguredRendererExternal(specifier)
    ) {
      return;
    }
    matches.push({
      configuredExternal: isConfiguredRendererExternal(specifier),
      offset: literal.getStart(sourceFile),
      specifier,
    });
  };
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addSpecifier(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      addSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
}

function verifyRendererBundle(assetsDirectory = DEFAULT_ASSETS_DIRECTORY) {
  if (!fs.existsSync(assetsDirectory) || !fs.statSync(assetsDirectory).isDirectory()) {
    throw new Error(`Renderer assets directory is unavailable: ${assetsDirectory}`);
  }

  const files = collectJavaScriptFiles(assetsDirectory);
  if (files.length === 0) {
    throw new Error(`Renderer build produced no JavaScript assets: ${assetsDirectory}`);
  }

  const failures = files.flatMap((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    return [
      ...findCommonJsRequireReferences(source).map((offset) => ({
        filePath,
        kind: "require",
        offset,
      })),
      ...findBrowserIncompatibleModuleSpecifiers(source).map((match) => ({
        filePath,
        kind: match.configuredExternal ? "configured-external" : "bare-import",
        offset: match.offset,
        specifier: match.specifier,
      })),
    ];
  });

  if (failures.length > 0) {
    const summary = failures
      .slice(0, 10)
      .map(
        ({ filePath, kind, offset, specifier }) =>
          `${path.relative(assetsDirectory, filePath)}@${offset}:${kind}${
            specifier ? `:${specifier}` : ""
          }`
      )
      .join(", ");
    throw new Error(
      `Renderer bundle contains browser-incompatible module references (${summary}). ` +
        "Use browser-compatible ESM imports in renderer code."
    );
  }

  return { assetsDirectory, filesChecked: files.length };
}

if (require.main === module) {
  try {
    const result = verifyRendererBundle(
      process.argv[2] ? path.resolve(process.argv[2]) : undefined
    );
    console.log(`[renderer-bundle] PASS: checked ${result.filesChecked} JavaScript asset(s)`);
  } catch (error) {
    console.error(`[renderer-bundle] FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  collectJavaScriptFiles,
  findBrowserIncompatibleModuleSpecifiers,
  findCommonJsRequireReferences,
  isConfiguredRendererExternal,
  verifyRendererBundle,
};
