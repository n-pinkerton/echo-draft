import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

const { purgeDebugArtifactsAtRoot } = require("../debugArtifacts");

const tempRoots: string[] = [];

const makeTempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-debug-purge-"));
  tempRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("purgeDebugArtifactsAtRoot", () => {
  it("deletes only EchoDraft logs and captured audio", () => {
    const root = makeTempRoot();
    const audioDir = path.join(root, "audio");
    fs.mkdirSync(audioDir);
    fs.writeFileSync(path.join(root, "echodraft-debug-2026-07-13.jsonl"), "log");
    fs.writeFileSync(path.join(root, "keep-me.txt"), "keep");
    fs.writeFileSync(path.join(audioDir, "echodraft-audio-2026-07-13-test.webm"), "audio");
    fs.writeFileSync(path.join(audioDir, "echodraft-audio-2026-07-13-test.json"), "metadata");
    fs.writeFileSync(path.join(audioDir, "unrelated.wav"), "keep");

    const result = purgeDebugArtifactsAtRoot(root);

    expect(result.success).toBe(true);
    expect(result.filesDeleted).toBe(3);
    expect(result.bytesDeleted).toBe(Buffer.byteLength("logaudio" + "metadata"));
    expect(fs.existsSync(path.join(root, "echodraft-debug-2026-07-13.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(root, "keep-me.txt"))).toBe(true);
    expect(fs.existsSync(path.join(audioDir, "unrelated.wav"))).toBe(true);
  });

  it("removes the audio directory only when no preserved entries remain", () => {
    const root = makeTempRoot();
    const audioDir = path.join(root, "audio");
    fs.mkdirSync(audioDir);
    fs.writeFileSync(path.join(audioDir, "echodraft-audio-test.wav"), "audio");

    const result = purgeDebugArtifactsAtRoot(root);

    expect(result.success).toBe(true);
    expect(result.directoriesDeleted).toBe(1);
    expect(fs.existsSync(audioDir)).toBe(false);
  });

  it("rejects relative roots and linked roots", () => {
    expect(purgeDebugArtifactsAtRoot("relative-logs").success).toBe(false);

    const target = makeTempRoot();
    const link = `${target}-link`;
    try {
      fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    } catch {
      // Some Windows environments disallow test-created links. Relative-root coverage still runs.
      return;
    }

    try {
      const result = purgeDebugArtifactsAtRoot(link);
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
});
