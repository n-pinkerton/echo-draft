import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { purgeDebugArtifactsAtRoot } = require("../debugArtifacts");

const tempRoots: string[] = [];

const makeTempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-debug-purge-"));
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("purgeDebugArtifactsAtRoot", () => {
  it("deletes only EchoDraft logs and captured audio", async () => {
    const root = makeTempRoot();
    const audioDir = path.join(root, "audio");
    fs.mkdirSync(audioDir);
    fs.writeFileSync(path.join(root, "echodraft-debug-2026-07-13.jsonl"), "log");
    fs.writeFileSync(path.join(root, "keep-me.txt"), "keep");
    fs.writeFileSync(path.join(audioDir, "echodraft-audio-2026-07-13-test.webm"), "audio");
    fs.writeFileSync(path.join(audioDir, "echodraft-audio-2026-07-13-test.json"), "metadata");
    fs.writeFileSync(path.join(audioDir, "unrelated.wav"), "keep");

    const result = await purgeDebugArtifactsAtRoot(root);

    expect(result.success).toBe(true);
    expect(result.filesDeleted).toBe(3);
    expect(result.bytesDeleted).toBe(Buffer.byteLength("logaudio" + "metadata"));
    expect(fs.existsSync(path.join(root, "echodraft-debug-2026-07-13.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(root, "keep-me.txt"))).toBe(true);
    expect(fs.existsSync(path.join(audioDir, "unrelated.wav"))).toBe(true);
  });

  it("removes the audio directory only when no preserved entries remain", async () => {
    const root = makeTempRoot();
    const audioDir = path.join(root, "audio");
    fs.mkdirSync(audioDir);
    fs.writeFileSync(path.join(audioDir, "echodraft-audio-test.wav"), "audio");

    const result = await purgeDebugArtifactsAtRoot(root);

    expect(result.success).toBe(true);
    expect(result.directoriesDeleted).toBe(1);
    expect(fs.existsSync(audioDir)).toBe(false);
  });

  it("rejects relative roots and linked roots", async () => {
    await expect(purgeDebugArtifactsAtRoot("relative-logs")).resolves.toMatchObject({
      success: false,
    });

    const target = makeTempRoot();
    const link = `${target}-link`;
    try {
      fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      // Some Windows environments disallow test-created links. Relative-root coverage still runs.
      return;
    }

    try {
      const result = await purgeDebugArtifactsAtRoot(link);
      expect(result.success).toBe(false);
      expect(result.errors.join(" ")).toContain("linked logs folder");
    } finally {
      if (process.platform === "win32") {
        fs.rmdirSync(link);
      } else {
        fs.unlinkSync(link);
      }
    }
  });

  it("reports failure and residual artifacts when an expected file cannot be deleted", async () => {
    const root = makeTempRoot();
    const logPath = path.join(root, "echodraft-debug-2026-07-13.jsonl");
    fs.writeFileSync(logPath, "sensitive log");
    const isolatedNames: string[] = [];
    vi.spyOn(fs.promises, "unlink").mockImplementation(async (target) => {
      if (path.basename(String(target)).startsWith(".echodraft-purge-file-")) {
        isolatedNames.push(path.basename(String(target)));
        throw Object.assign(new Error("locked"), { code: "EPERM" });
      }
      throw new Error(`Unexpected unlink target: ${String(target)}`);
    });

    const result = await purgeDebugArtifactsAtRoot(root);

    expect(result).toMatchObject({ success: false, filesDeleted: 0, residualArtifacts: 1 });
    expect(result.errors.join(" ")).toMatch(/could not delete|remains/i);
    expect(fs.existsSync(logPath)).toBe(false);
    expect(isolatedNames).toHaveLength(1);
    expect(fs.existsSync(path.join(root, isolatedNames[0]))).toBe(true);
  });

  it("never follows a linked expected audio artifact", async () => {
    const root = makeTempRoot();
    const audioDir = path.join(root, "audio");
    fs.mkdirSync(audioDir);
    const outside = path.join(makeTempRoot(), "outside.wav");
    fs.writeFileSync(outside, "private outside data");
    const link = path.join(audioDir, "echodraft-audio-linked.wav");
    try {
      fs.symlinkSync(outside, link, "file");
    } catch {
      return;
    }

    const result = await purgeDebugArtifactsAtRoot(root);

    expect(result.success).toBe(false);
    expect(fs.readFileSync(outside, "utf8")).toBe("private outside data");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it("cleans diagnostic audio left in a stale quarantine from an interrupted purge", async () => {
    const root = makeTempRoot();
    const quarantineDir = path.join(root, ".echodraft-purge-123-0123456789abcdef");
    fs.mkdirSync(quarantineDir);
    fs.writeFileSync(path.join(quarantineDir, "echodraft-audio-stale.webm"), "stale audio");

    const result = await purgeDebugArtifactsAtRoot(root);

    expect(result).toMatchObject({ success: true, filesDeleted: 1, residualArtifacts: 0 });
    expect(fs.existsSync(quarantineDir)).toBe(false);
  });

  it("cleans an isolated diagnostic file left by an interrupted unlink", async () => {
    const root = makeTempRoot();
    const quarantineFile = path.join(root, ".echodraft-purge-file-123-0123456789abcdef");
    fs.writeFileSync(quarantineFile, "stale diagnostic data");

    const result = await purgeDebugArtifactsAtRoot(root);

    expect(result).toMatchObject({ success: true, filesDeleted: 1, residualArtifacts: 0 });
    expect(fs.existsSync(quarantineFile)).toBe(false);
  });

  it("does not unlink an isolated object if the verified root changes before deletion", async () => {
    const root = makeTempRoot();
    const outsideRoot = makeTempRoot();
    const outside = path.join(outsideRoot, "echodraft-debug-2026-07-13.jsonl");
    const logPath = path.join(root, "echodraft-debug-2026-07-13.jsonl");
    fs.writeFileSync(logPath, "diagnostic data");
    fs.writeFileSync(outside, "outside private data");

    const realRename = fs.promises.rename.bind(fs.promises);
    const realLstat = fs.promises.lstat.bind(fs.promises);
    let rootChanged = false;
    vi.spyOn(fs.promises, "rename").mockImplementation(async (source, destination) => {
      await realRename(source, destination);
      if (path.resolve(String(source)) === path.resolve(logPath)) rootChanged = true;
    });
    vi.spyOn(fs.promises, "lstat").mockImplementation(async (target) => {
      const stat = await realLstat(target);
      if (rootChanged && path.resolve(String(target)) === path.resolve(root)) {
        const changedStat = Object.create(Object.getPrototypeOf(stat));
        Object.assign(changedStat, stat);
        changedStat.isSymbolicLink = () => true;
        return changedStat;
      }
      return stat;
    });
    const unlinkSpy = vi.spyOn(fs.promises, "unlink");

    const result = await purgeDebugArtifactsAtRoot(root);

    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toMatch(/logs folder changed|not deleted/i);
    expect(unlinkSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(outside, "utf8")).toBe("outside private data");
    expect(fs.readdirSync(root).some((name) => name.startsWith(".echodraft-purge-file-"))).toBe(
      true
    );
  });
});
