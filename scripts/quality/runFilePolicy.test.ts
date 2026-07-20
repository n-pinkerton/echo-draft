import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { inspectChangedFile, runFilePolicy } = require("./runFilePolicy.cjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MAX_SUPPORTED_SOURCE_BYTES } = require("./filePolicy.js");

const regularFile = (size: number) => ({
  size,
  isFile: () => true,
  isSymbolicLink: () => false,
});

const treeEntry = (filePath: string, byteSize: number, objectId = "a".repeat(40)) =>
  `100644 blob ${objectId} ${byteSize}\t${filePath}\0`;

const fileSystemFor = (source: string) => ({
  lstatSync: () => regularFile(Buffer.byteLength(source)),
  readFileSync: () => source,
});

describe("runFilePolicy", () => {
  it("skips unsupported and linked paths before read and reports oversized source", () => {
    const root = path.resolve("quality-test-root");
    const lstatSync = vi.fn((absolutePath: string) => {
      if (absolutePath.endsWith("linked.js")) {
        return { size: 10, isFile: () => true, isSymbolicLink: () => true };
      }
      if (absolutePath.endsWith("oversized.ts")) {
        return {
          size: MAX_SUPPORTED_SOURCE_BYTES + 1,
          isFile: () => true,
          isSymbolicLink: () => false,
        };
      }
      throw new Error(`Unexpected lstat: ${absolutePath}`);
    });
    const readFileSync = vi.fn(() => {
      throw new Error("Changed-file content must not be read");
    });
    const logs: string[] = [];

    const findings = runFilePolicy({
      root,
      getChangedFiles: () => ({
        base: "base",
        files: ["assets/image.bin", "src/linked.js", "src/oversized.ts"],
      }),
      fsApi: {
        existsSync: () => false,
        lstatSync,
        readFileSync,
      },
      execFile: () => "",
      log: (message: string) => logs.push(message),
    });

    expect(lstatSync).toHaveBeenCalledTimes(2);
    expect(readFileSync).not.toHaveBeenCalled();
    expect(findings).toEqual([
      {
        level: "error",
        code: "supported-source-too-large",
        filePath: "src/oversized.ts",
        byteSize: MAX_SUPPORTED_SOURCE_BYTES + 1,
      },
    ]);
    expect(logs[0]).toContain(`${MAX_SUPPORTED_SOURCE_BYTES + 1} bytes`);
  });

  it("uses NUL-safe rename metadata and the original Unicode control-character path for base lookup", () => {
    const sourcePath = "src/original-雪\tpart\nline.js";
    const destinationPath = "src/renamed-雪\tpart\nline.js";
    const previous = "const previous = true;\n";
    const calls: string[][] = [];

    const findings = runFilePolicy({
      root: path.resolve("quality-test-root"),
      getChangedFiles: () => ({ base: "base", files: [destinationPath] }),
      fsApi: {
        existsSync: () => false,
        ...fileSystemFor("const current = true;\n"),
      },
      execFile: (_executable: string, args: string[]) => {
        calls.push(args);
        if (args[0] === "diff") return `R100\0${sourcePath}\0${destinationPath}\0`;
        if (args.includes("ls-tree")) return treeEntry(sourcePath, Buffer.byteLength(previous));
        if (args[0] === "show") return previous;
        throw new Error(`Unexpected Git call: ${args.join(" ")}`);
      },
      log: () => {},
    });

    expect(findings).toEqual([]);
    expect(calls[0]).toEqual(["diff", "--name-status", "-z", "-M", "base", "--"]);
    const lookup = calls.find((args) => args.includes("ls-tree"));
    expect(lookup).toEqual([
      "--literal-pathspecs",
      "ls-tree",
      "-z",
      "-l",
      "base",
      "--",
      sourcePath,
    ]);
  });

  it("reads a 1-2 MiB existing base with an adequate buffer and applies grandfathered growth", () => {
    const previous = `${"const previous = true;\n".repeat(500)}/*${"x".repeat(1024 * 1024)}*/`;
    const current = "const current = true;\n".repeat(501);
    const showOptions: Array<{ maxBuffer: number }> = [];

    const findings = inspectChangedFile({
      root: path.resolve("quality-test-root"),
      relativePath: "src/existing.js",
      base: "base",
      fsApi: fileSystemFor(current),
      execFile: (_executable: string, args: string[], options: { maxBuffer: number }) => {
        if (args.includes("ls-tree"))
          return treeEntry("src/existing.js", Buffer.byteLength(previous));
        if (args[0] === "show") {
          showOptions.push(options);
          return previous;
        }
        throw new Error(`Unexpected Git call: ${args.join(" ")}`);
      },
    });

    expect(Buffer.byteLength(previous)).toBeGreaterThan(1024 * 1024);
    expect(showOptions[0].maxBuffer).toBeGreaterThan(Buffer.byteLength(previous));
    expect(findings).toEqual([
      {
        level: "warn",
        code: "grandfathered-file-growth",
        filePath: "src/existing.js",
        logicalLines: 501,
      },
    ]);
  });

  it("does not read an oversized base and conservatively keeps it existing", () => {
    const current = "const current = true;\n".repeat(600);
    const show = vi.fn(() => {
      throw new Error("Oversized base content must not be read");
    });

    const findings = inspectChangedFile({
      root: path.resolve("quality-test-root"),
      relativePath: "src/existing.js",
      base: "base",
      fsApi: fileSystemFor(current),
      execFile: (_executable: string, args: string[]) => {
        if (args.includes("ls-tree"))
          return treeEntry("src/existing.js", MAX_SUPPORTED_SOURCE_BYTES + 1);
        if (args[0] === "show") return show();
        throw new Error(`Unexpected Git call: ${args.join(" ")}`);
      },
    });

    expect(show).not.toHaveBeenCalled();
    expect(findings).toEqual([
      {
        level: "warn",
        code: "base-source-too-large",
        filePath: "src/existing.js",
        byteSize: MAX_SUPPORTED_SOURCE_BYTES + 1,
      },
    ]);
  });

  it("propagates a base read failure after the path is proven to exist", () => {
    const failure = new Error("git show failed");

    expect(() =>
      inspectChangedFile({
        root: path.resolve("quality-test-root"),
        relativePath: "src/existing.js",
        base: "base",
        fsApi: fileSystemFor("const current = true;\n"),
        execFile: (_executable: string, args: string[]) => {
          if (args.includes("ls-tree")) return treeEntry("src/existing.js", 10);
          if (args[0] === "show") throw failure;
          throw new Error(`Unexpected Git call: ${args.join(" ")}`);
        },
      })
    ).toThrow(failure);
  });

  it("classifies only an absent base tree path as new", () => {
    const findings = inspectChangedFile({
      root: path.resolve("quality-test-root"),
      relativePath: "src/new.js",
      base: "base",
      fsApi: fileSystemFor("const current = true;\n".repeat(501)),
      execFile: (_executable: string, args: string[]) => {
        if (args.includes("ls-tree")) return "";
        throw new Error(`Unexpected Git call: ${args.join(" ")}`);
      },
    });

    expect(findings).toEqual([
      {
        level: "error",
        code: "new-production-file-size",
        filePath: "src/new.js",
        logicalLines: 501,
      },
    ]);
  });

  it("exits 1 from the CLI for an oversized current source", () => {
    const root = mkdtempSync(path.join(tmpdir(), "quality-file-policy-cli-"));
    try {
      execFileSync("git", ["init", "--initial-branch=main"], { cwd: root, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "quality@example.invalid"], { cwd: root });
      execFileSync("git", ["config", "user.name", "Quality Tests"], { cwd: root });
      execFileSync("git", ["commit", "--allow-empty", "--no-gpg-sign", "-m", "base"], {
        cwd: root,
        stdio: "ignore",
      });
      const base = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim();
      writeFileSync(
        path.join(root, "oversized.js"),
        Buffer.alloc(MAX_SUPPORTED_SOURCE_BYTES + 1, 32)
      );

      const result = spawnSync(
        process.execPath,
        [path.resolve("scripts/quality/runFilePolicy.cjs")],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, QUALITY_BASE_SHA: base },
        }
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("ERROR supported-source-too-large oversized.js");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 15_000);
});
