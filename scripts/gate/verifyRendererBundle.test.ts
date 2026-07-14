import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const {
  findBrowserIncompatibleModuleSpecifiers,
  findCommonJsRequireReferences,
  isConfiguredRendererExternal,
  verifyRendererBundle,
} = require("./verifyRendererBundle.js");

const temporaryDirectories: string[] = [];

const createAssetsDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-renderer-bundle-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("renderer bundle verification", () => {
  it("accepts browser-compatible JavaScript assets", () => {
    const assets = createAssetsDirectory();
    fs.writeFileSync(
      path.join(assets, "index.js"),
      'const label = "require is unavailable"; export { label };',
      "utf8"
    );

    expect(verifyRendererBundle(assets)).toMatchObject({ filesChecked: 1 });
  });

  it("rejects an unbound CommonJS require left in a renderer bundle", () => {
    const assets = createAssetsDirectory();
    fs.writeFileSync(
      path.join(assets, "index.js"),
      'const dictionary = require("./dictionary.cjs");',
      "utf8"
    );

    expect(() => verifyRendererBundle(assets)).toThrow(/browser-incompatible module references/);
  });

  it("reports every direct require offset deterministically", () => {
    expect(
      findCommonJsRequireReferences(
        "const first=require(\"one\");\nconst second = require ('two');"
      )
    ).toHaveLength(2);
  });

  it("ignores require-shaped text and non-computed property names", () => {
    expect(
      findCommonJsRequireReferences(
        'const example = "require(\\\"text-only\\\")"; const client = { require() {} }; client.require("safe"); const options = { require: false };'
      )
    ).toEqual([]);
  });

  it("allows a locally bound require without hiding an unbound sibling scope", () => {
    expect(
      findCommonJsRequireReferences(
        'function local(require) { return require("safe"); } const unsafe = require("bad");'
      )
    ).toHaveLength(1);
  });

  it.each([
    ['(require)("x")', 1],
    ['(0, require)("x")', 1],
    ["const alias = require; alias('x')", 1],
    ["const value = require(moduleName)", 1],
    ["typeof require", 1],
    ['module.require("x")', 1],
    ['globalThis["require"]("x")', 1],
  ])("rejects every standalone CommonJS reference in %s", (source, expectedCount) => {
    expect(findCommonJsRequireReferences(source)).toHaveLength(expectedCount);
  });

  it("rejects configured externals and every other bare ESM specifier", () => {
    expect(
      findBrowserIncompatibleModuleSpecifiers(
        'import fs from "fs"; import "unbundled-package"; import("node:path"); import("./safe-chunk.js"); export { value } from "@aws-sdk/client-s3";'
      ).map(({ specifier }: { specifier: string }) => specifier)
    ).toEqual(["fs", "unbundled-package", "node:path", "@aws-sdk/client-s3"]);
    expect(isConfiguredRendererExternal("node:fs/promises")).toBe(true);
    expect(isConfiguredRendererExternal("unbundled-package")).toBe(false);
  });

  it("fails the built artifact when Vite leaves a bare import", () => {
    const assets = createAssetsDirectory();
    fs.writeFileSync(path.join(assets, "index.js"), 'import fs from "fs";', "utf8");
    expect(() => verifyRendererBundle(assets)).toThrow(/configured-external:fs/);
  });

  it.each([
    ['import "node:buffer";', "node:buffer"],
    ['import("node:worker_threads");', "node:worker_threads"],
  ])("rejects an unlisted Node built-in specifier in %s", (source, specifier) => {
    const assets = createAssetsDirectory();
    fs.writeFileSync(path.join(assets, "index.js"), source, "utf8");

    expect(() => verifyRendererBundle(assets)).toThrow(
      new RegExp(`browser-incompatible module references.*${specifier}`)
    );
  });

  it("fails when the renderer build contains no JavaScript assets", () => {
    const assets = createAssetsDirectory();
    expect(() => verifyRendererBundle(assets)).toThrow(/no JavaScript assets/);
  });
});
