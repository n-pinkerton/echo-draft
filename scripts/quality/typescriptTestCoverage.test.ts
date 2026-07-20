import { readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(__dirname, "../..");
const testProjectPaths = ["src/tsconfig.test.json", "tsconfig.scripts-test.json"];
const typescriptTestPattern = /\.test\.tsx?$/;

const relativePath = (filePath: string) =>
  path.relative(repositoryRoot, filePath).split(path.sep).join("/");

const findTypescriptTests = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findTypescriptTests(entryPath);
      return entry.isFile() && typescriptTestPattern.test(entry.name) ? [entryPath] : [];
    });

const parseTestProject = (configRelativePath: string) => {
  const configPath = path.join(repositoryRoot, configRelativePath);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath
  );
  const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors];

  if (diagnostics.length > 0) {
    throw new Error(
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => repositoryRoot,
        getNewLine: () => "\n",
      })
    );
  }

  return parsed.fileNames.map((fileName) => path.resolve(fileName));
};

describe("TypeScript test-project coverage", () => {
  it("includes every TypeScript Vitest test under src and scripts", () => {
    const testFiles = ["src", "scripts"]
      .flatMap((directory) => findTypescriptTests(path.join(repositoryRoot, directory)))
      .map(relativePath)
      .sort();
    const coveredFiles = new Set(testProjectPaths.flatMap(parseTestProject).map(relativePath));
    const missingFiles = testFiles.filter((fileName) => !coveredFiles.has(fileName));

    expect(testFiles).toContain("scripts/quality/typescriptTestCoverage.test.ts");
    if (missingFiles.length > 0) {
      throw new Error(`TypeScript test-project coverage is missing:\n${missingFiles.join("\n")}`);
    }
  });
});
