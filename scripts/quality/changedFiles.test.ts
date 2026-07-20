import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { changedFiles, resolveBase, EMPTY_TREE } = require("./changedFiles.cjs");

const repositories: string[] = [];

const git = (root: string, args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const write = (root: string, relativePath: string, source: string) => {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
};

const commit = (root: string, message: string) => {
  git(root, ["add", "--all"]);
  git(root, ["commit", "--no-gpg-sign", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
};

const createRepository = () => {
  const root = mkdtempSync(join(tmpdir(), "quality-changed-files-"));
  repositories.push(root);
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.email", "quality@example.invalid"]);
  git(root, ["config", "user.name", "Quality Tests"]);
  return root;
};

afterEach(() => {
  for (const root of repositories.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveBase", () => {
  it("keeps valid requested commits exact", () => {
    const root = createRepository();
    write(root, "base.js", "const base = true;\n");
    const base = commit(root, "base");
    const diagnostics: string[] = [];

    expect(resolveBase(root, base, "main", (message: string) => diagnostics.push(message))).toBe(
      base
    );
    expect(diagnostics).toEqual([]);
  });

  it("falls back from zero and unavailable push SHAs to the default-branch merge base", () => {
    const root = createRepository();
    write(root, "base.js", "const base = true;\n");
    const base = commit(root, "base");
    git(root, ["switch", "-c", "feature"]);
    write(root, "feature.js", "const feature = true;\n");
    commit(root, "feature");

    const zeroDiagnostics: string[] = [];
    expect(
      resolveBase(root, "0".repeat(40), "main", (message: string) => zeroDiagnostics.push(message))
    ).toBe(base);
    expect(zeroDiagnostics.join(" ")).toContain("using merge-base with main");

    const unavailableDiagnostics: string[] = [];
    const unavailable = "f".repeat(40);
    expect(
      resolveBase(root, unavailable, "main", (message: string) =>
        unavailableDiagnostics.push(message)
      )
    ).toBe(base);
    expect(unavailableDiagnostics.join(" ")).toContain(`${unavailable} is unavailable`);
    expect(unavailableDiagnostics.join(" ")).toContain("using merge-base with main");
  });

  it("uses the empty tree when orphan history has no default-branch merge base", () => {
    const root = createRepository();
    write(root, "main.js", "const main = true;\n");
    commit(root, "main");
    git(root, ["switch", "--orphan", "orphan"]);
    rmSync(join(root, "main.js"), { force: true });
    write(root, "orphan.js", "const orphan = true;\n");
    commit(root, "orphan");
    const diagnostics: string[] = [];

    expect(
      resolveBase(root, "0".repeat(40), "main", (message: string) => diagnostics.push(message))
    ).toBe(EMPTY_TREE);
    expect(diagnostics.join(" ")).toContain("using empty tree");
  });
});

describe("changedFiles", () => {
  it("handles renames, deletions, spaces, and leading-hyphen paths", () => {
    const root = createRepository();
    write(root, "old.js", "const renamed = true;\n");
    write(root, "deleted.js", "const deleted = true;\n");
    const base = commit(root, "base");

    mkdirSync(join(root, "src"), { recursive: true });
    renameSync(join(root, "old.js"), join(root, "src", "new name.js"));
    rmSync(join(root, "deleted.js"));
    write(root, "-leading.js", "const leading = true;\n");
    commit(root, "rename and delete");
    write(root, "space name.ts", "const spaced = true;\n");

    const result = changedFiles(root, base);
    expect(result.files).toEqual(
      expect.arrayContaining(["src/new name.js", "-leading.js", "space name.ts"])
    );
    expect(result.files).not.toContain("old.js");
    expect(result.files).not.toContain("deleted.js");
  });
});
