import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(__dirname, "../../src");
const eslint = new ESLint({
  cwd: srcRoot,
  overrideConfigFile: path.join(srcRoot, "eslint.config.js"),
});
const boundaryMessages = async (code: string, filename = "hooks/rendererBoundaryFixture.js") => {
  const [result] = await eslint.lintText(code, { filePath: path.join(srcRoot, filename) });
  return result.messages.filter(
    ({ ruleId }) =>
      ruleId === "echodraft-policy/renderer-boundary" || ruleId === "no-restricted-globals"
  );
};
const expectRejected = async (code: string, filename?: string) => {
  expect(await boundaryMessages(code, filename)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ message: "Renderer code must use the preload IPC boundary." }),
    ])
  );
};

const mainOnlyModules = [
  "utils.js",
  "updater.js",
  "services/localReasoningBridge.js",
  "services/LocalReasoningService.ts",
  "utils/process.js",
  "utils/serverUtils.js",
  "config/updateTrust.js",
  "config/iconPaths.cjs",
  "config/rendererExternalModules.cjs",
  "config/InferenceConfig.ts",
];
const nativeRendererExternals = [
  "better-sqlite3",
  "dbus-next",
  "ffmpeg-static",
  "fs-extra",
  "graceful-fs",
];
const staticAliasAccess = (aliasCount: number, propertyName: string) => {
  const declarations = Array.from({ length: aliasCount + 1 }, (_, index) =>
    index === 0
      ? `const key0 = ${JSON.stringify(propertyName)};`
      : `const key${index} = key${index - 1};`
  ).join(" ");
  return `${declarations} void globalThis[key${aliasCount}];`;
};

describe("renderer boundary policy", () => {
  it.each([
    'import archive from "tar";',
    'import parser from "tar/lib/parse";',
    'import archive from "unzipper";',
    'import extract from "unzipper/lib/extract";',
    'import client from "@aws-sdk/client-s3";',
    'import client from "@aws-sdk/client-s3/runtimeConfig";',
    'const module = import("node:fs");',
    'export { readFile } from "fs";',
    'import database from "../helpers/database";',
  ])("rejects %s", async (code) => {
    await expectRejected(code);
  });

  it.each(nativeRendererExternals.flatMap((moduleName) => [moduleName, `${moduleName}/subpath`]))(
    "rejects Node/native renderer external %s",
    async (moduleName) => {
      await expectRejected(`import dependency from "${moduleName}";`);
    }
  );

  it.each(
    mainOnlyModules.flatMap((modulePath) => {
      const withoutExtension = modulePath.replace(/\.(?:[cm]?[jt]sx?)$/i, "");
      return [`../${withoutExtension}`, `@/${modulePath}`];
    })
  )("rejects main-only module %s", async (moduleName) => {
    await expectRejected(`import mainOnly from "${moduleName}";`);
  });

  it("matches main-only paths case-insensitively", async () => {
    await expectRejected('import mainOnly from "@/SeRvIcEs/LoCaLrEaSoNiNgBrIdGe.Js";');
  });

  it.each(['import mainOnly from "@/UtIlS";', 'import mainOnly from "../UpDaTeR.Js";'])(
    "matches root main-only path case-insensitively: %s",
    async (code) => {
      await expectRejected(code);
    }
  );

  it.each([
    'import AudioManager from "../helpers/audioManager";',
    'import cancellation from "../helpers/audio/pipeline/cancellation";',
    'import contract from "../helpers/mobileInboxContract.cjs";',
  ])("allows renderer-safe helper import %s", async (code) => {
    expect(await boundaryMessages(code)).toEqual([]);
  });

  it("applies the boundary to the shared mobile inbox contract", async () => {
    await expectRejected(
      'const fs = require("node:fs"); module.exports = fs;',
      "helpers/mobileInboxContract.cjs"
    );
  });

  it.each([
    [
      'const policy = require("../utils/languagePolicy.cjs"); module.exports = policy;',
      "config/cleanupPolicy.cjs",
    ],
    [
      'const registry = require("../config/languageRegistry.json"); module.exports = registry;',
      "utils/languagePolicy.cjs",
    ],
  ])("allows static renderer-safe CommonJS imports in %s", async (code, filename) => {
    expect(await boundaryMessages(code, filename)).toEqual([]);
  });

  it.each([
    'const load = require; load("node:fs");',
    'require.bind(null)("node:fs");',
    'require.call(null, "node:fs");',
    'require.apply(null, ["node:fs"]);',
    '(0, require)("node:fs");',
    'module.require("node:fs");',
    'globalThis.require("node:fs");',
    'globalThis["require"]("node:fs");',
    'const { require: load } = globalThis; load("node:fs");',
    'const { ["require"]: load } = module; load("node:fs");',
    'window.require("node:fs");',
  ])("rejects alternate access to the global CommonJS loader: %s", async (code) => {
    await expectRejected(code);
  });

  it.each([
    'module[`require`]("node:fs");',
    'module["requ" + "ire"]("node:fs");',
    'const key = "require"; module[key]("node:fs");',
    'const key = `require`; module[key]("node:fs");',
    'const loader = module; loader.require("node:fs");',
    'globalThis[`require`]("node:fs");',
    'globalThis["requ" + "ire"]("node:fs");',
    'const key = "require"; globalThis[key]("node:fs");',
    'String.fromCharCode = () => "require"; const key = String.fromCharCode(120); globalThis[key]("node:fs");',
    'const {[`require`]: load} = module; load("node:fs");',
    'Reflect.get(module, "require")("node:fs");',
    'Reflect.get(globalThis, "require")("node:fs");',
    'const loader = globalThis; loader.require("node:fs");',
    'globalThis.module.require("node:fs");',
    'globalThis["module"]["require"]("node:fs");',
    'window.module.require("node:fs");',
    'const g = globalThis; g.module.require("node:fs");',
    'module.foo.require("node:fs");',
  ])("rejects computed, aliased, or reflected global loader access: %s", async (code) => {
    await expectRejected(code);
  });

  it.each([
    'declare const require: (name: string) => unknown; require("node:fs");',
    'declare function require(name: string): unknown; require("node:fs");',
    'declare const module: { require(name: string): unknown }; module.require("node:fs");',
    'declare const globalThis: { require(name: string): unknown }; globalThis.require("node:fs");',
    'export {}; declare global { const require: (name: string) => unknown; } require("node:fs");',
  ])("rejects runtime loader access hidden by an erased ambient declaration: %s", async (code) => {
    await expectRejected(code, "hooks/rendererBoundaryFixture.ts");
  });

  it.each([
    'function load(require) { return require("node:fs"); }',
    'function load(require) { const alias = require; return alias("node:fs"); }',
    'const require = (target) => target; require("node:fs");',
    'const module = { require: (target) => target }; module.require("node:fs");',
    'function require(target) { return target; } require("node:fs");',
    'const globalThis = { require: (target) => target }; globalThis.require("node:fs");',
    'function load(module, globalThis) { module.require("node:fs"); globalThis.require("node:fs"); }',
  ])("allows locally shadowed loader identifiers: %s", async (code) => {
    expect(await boundaryMessages(code)).toEqual([]);
  });

  it("allows a genuine TypeScript overload implementation named require", async () => {
    expect(
      await boundaryMessages(
        'function require(name: string): unknown; function require(name: string) { return name; } require("node:fs");',
        "hooks/rendererBoundaryFixture.ts"
      )
    ).toEqual([]);
  });

  it.each([
    "module.exports = {};",
    "module.exports.someExport = {};",
    "module[`exports`] = {};",
    'module["exports"]["someExport"] = {};',
    'module["ex" + "ports"] = {};',
    'const key = "exports"; module[key] = {};',
    "void globalThis.crypto;",
    "void globalThis.AudioContext;",
    "void window.location.href;",
    "void globalThis.crypto.subtle;",
    'void (typeof globalThis === "undefined");',
    'void (typeof window === "undefined");',
    "void globalThis[`crypto`];",
    'void globalThis["Audio" + "Context"];',
    "const key = `crypto`; void globalThis[key];",
    "const runtimeGlobal = globalThis; void runtimeGlobal.crypto;",
    "const runtimeGlobal = globalThis; void runtimeGlobal.crypto.subtle;",
    "const runtimeGlobal = globalThis as unknown as { crypto: Crypto }; void runtimeGlobal.crypto;",
    'function read(target = typeof window !== "undefined" ? window : undefined) { if (!target) return; return target.crypto; }',
  ])("allows proven safe direct global-container property access: %s", async (code) => {
    expect(await boundaryMessages(code, "helpers/audio/rendererBoundaryFixture.cjs")).toEqual([]);
  });

  it.each([
    "module[getKey()]();",
    'let key = "exports"; module[key] = {};',
    "globalThis[getKey()];",
    'let key = "crypto"; void globalThis[key];',
    "const runtimeGlobal = globalThis; consume(runtimeGlobal);",
  ])("rejects unproven global-container property access: %s", async (code) => {
    await expectRejected(code, "helpers/audio/rendererBoundaryFixture.cjs");
  });

  it("allows an immutable static key at the recursion budget", async () => {
    expect(await boundaryMessages(staticAliasAccess(11, "crypto"))).toEqual([]);
  });

  it("rejects an immutable static key beyond the recursion budget", async () => {
    await expectRejected(staticAliasAccess(12, "crypto"));
  });

  it("allows an immutable static key at the output-length budget", async () => {
    expect(await boundaryMessages(`void globalThis[${JSON.stringify("x".repeat(256))}];`)).toEqual(
      []
    );
  });

  it("rejects an immutable static key beyond the output-length budget", async () => {
    await expectRejected(`void globalThis[${JSON.stringify("x".repeat(257))}];`);
  });

  it("ignores erased TypeScript type-query references", async () => {
    expect(
      await boundaryMessages(
        "type BrowserGlobal = typeof globalThis; type Loader = typeof require;",
        "hooks/rendererBoundaryFixture.ts"
      )
    ).toEqual([]);
  });

  it("checks the value side but ignores the type side of a TypeScript cast", async () => {
    const messages = await boundaryMessages(
      "const g = globalThis as typeof globalThis; consume(g);",
      "hooks/rendererBoundaryFixture.ts"
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({ message: "Renderer code must use the preload IPC boundary." })
    );
  });

  it.each([
    'type BrowserGlobal = typeof globalThis; globalThis.module.require("node:fs");',
    'type Loader = typeof require; require("node:fs");',
  ])("still rejects runtime loader access beside type-only references: %s", async (code) => {
    await expectRejected(code, "hooks/rendererBoundaryFixture.ts");
  });

  it.each([
    "const dependency = require();",
    'const dependency = require("node:fs", "extra");',
    "const dependency = require(42);",
    "const dependency = require(`node:fs`);",
    'const dependency = require?.("node:fs");',
  ])("rejects non-canonical direct loader calls: %s", async (code) => {
    await expectRejected(code);
  });

  it("allows a safe TypeScript external import-equals target", async () => {
    expect(
      await boundaryMessages(
        'import policy = require("../utils/languagePolicy.cjs"); void policy;',
        "hooks/rendererBoundaryFixture.ts"
      )
    ).toEqual([]);
  });

  it("rejects a restricted TypeScript external import-equals target", async () => {
    await expectRejected(
      'import fs = require("node:fs"); void fs;',
      "hooks/rendererBoundaryFixture.ts"
    );
  });

  it.each([
    ['const target = "node:fs"; const dependency = require(target);', "utils/dynamic.cjs"],
    ['const target = "node:fs"; const dependency = import(target);', "utils/dynamic.js"],
  ])("rejects computed module targets in %s", async (code, filename) => {
    await expectRejected(code, filename);
  });

  it.each([
    "App.tsx",
    "main.tsx",
    "components/rendererBoundaryFixture.cjs",
    "helpers/audio/rendererBoundaryFixture.mjs",
    "helpers/audio/rendererBoundaryFixture.cjs",
  ])("applies the boundary to %s", async (filename) => {
    await expectRejected('const fs = require("node:fs"); module.exports = fs;', filename);
  });
});
