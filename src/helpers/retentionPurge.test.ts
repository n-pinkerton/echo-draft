import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const { createRetentionManifest, executeRetentionManifest } = require("./retentionPurge");

const tempRoots: string[] = [];
const fixedNow = new Date("2026-08-09T12:00:00.000Z");

const makeTempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-retention-purge-"));
  tempRoots.push(root);
  return root;
};

const databaseSnapshot = (cutoffIso: string, suffix = "base") => ({
  version: 1,
  cutoffIso,
  sources: [{ table: "transcriptions", id: 1, fingerprint: suffix }],
  dependents: [],
  summary: {
    history: 1,
    todos: 0,
    pendingTodos: 0,
    actionedTodos: 0,
    alternatives: 0,
    correctionFlags: 0,
  },
  snapshotFingerprint: suffix,
});

const createDatabaseManager = () => {
  let suffix = "base";
  const buildRetentionDatabaseSnapshot = vi.fn((cutoffIso: string) =>
    databaseSnapshot(cutoffIso, suffix)
  );
  const deleteRetentionDatabaseSnapshot = vi.fn(() => ({
    success: true,
    historyDeleted: 1,
    todosDeleted: 0,
  }));
  return {
    buildRetentionDatabaseSnapshot,
    deleteRetentionDatabaseSnapshot,
    changeSnapshot: () => {
      suffix = "changed";
    },
  };
};

const createDebugLogger = (root: string, activePath: string | null = null) => ({
  getDebugArtifactRoots: () => [root],
  getLogPath: () => activePath,
});

const unlinkVerified = vi.fn(async (_root: string, target: string) => {
  const bytes = fs.statSync(target).size;
  fs.unlinkSync(target);
  return { success: true, deleted: true, bytes };
});

afterEach(() => {
  vi.restoreAllMocks();
  unlinkVerified.mockClear();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("30-day retention manifest", () => {
  it("selects old desktop logs by filename day while excluding active, newer, unrelated, and audio", async () => {
    const root = makeTempRoot();
    const oldLog = path.join(root, "echodraft-debug-2026-07-08.jsonl");
    const oldPart = path.join(root, "echodraft-debug-2026-07-08-part-001.jsonl");
    const activeLog = path.join(root, "echodraft-debug-2026-07-07.jsonl");
    const newerLog = path.join(root, "echodraft-debug-2026-07-10.jsonl");
    const unrelated = path.join(root, "notes.txt");
    const mobileDiagnostic = path.join(root, "echodraft-mobile-diagnostics.jsonl");
    const audioDir = path.join(root, "audio");
    fs.mkdirSync(audioDir);
    const audio = path.join(audioDir, "echodraft-audio-old.wav");
    fs.writeFileSync(oldLog, "old log");
    fs.writeFileSync(oldPart, "old part");
    fs.writeFileSync(activeLog, "active old log");
    fs.writeFileSync(newerLog, "newer log");
    fs.writeFileSync(unrelated, "keep");
    fs.writeFileSync(mobileDiagnostic, "mobile log");
    fs.writeFileSync(audio, "voice");
    const databaseManager = createDatabaseManager();
    const debugLogger = createDebugLogger(root, activeLog);

    const manifest = await createRetentionManifest({
      databaseManager,
      debugLogger,
      now: () => fixedNow,
    });

    expect(manifest.cutoffIso).toBe("2026-07-10T12:00:00.000Z");
    expect(manifest.logs.summary).toMatchObject({
      files: 2,
      activeLogsExcluded: 1,
      newerLogsExcluded: 1,
      audioEntriesExcluded: 1,
    });
    expect(manifest.logs.candidates.map((entry: any) => entry.name).sort()).toEqual(
      [path.basename(oldLog), path.basename(oldPart)].sort()
    );
    expect(Object.isFrozen(manifest)).toBe(true);

    const result = await executeRetentionManifest({
      manifest,
      databaseManager,
      debugLogger,
      deleteVerifiedPath: unlinkVerified,
    });

    expect(result).toMatchObject({
      success: true,
      database: { historyDeleted: 1 },
      logs: { success: true, filesDeleted: 2, residualFiles: 0 },
    });
    expect(fs.existsSync(oldLog)).toBe(false);
    expect(fs.existsSync(oldPart)).toBe(false);
    expect(fs.readFileSync(activeLog, "utf8")).toBe("active old log");
    expect(fs.readFileSync(newerLog, "utf8")).toBe("newer log");
    expect(fs.readFileSync(unrelated, "utf8")).toBe("keep");
    expect(fs.readFileSync(mobileDiagnostic, "utf8")).toBe("mobile log");
    expect(fs.readFileSync(audio, "utf8")).toBe("voice");
  });

  it("rejects all deletion when a previewed file is mutated or replaced", async () => {
    const root = makeTempRoot();
    const mutated = path.join(root, "echodraft-debug-2026-06-01.jsonl");
    const unchanged = path.join(root, "echodraft-debug-2026-06-02.jsonl");
    fs.writeFileSync(mutated, "original");
    fs.writeFileSync(unchanged, "also original");
    const databaseManager = createDatabaseManager();
    const debugLogger = createDebugLogger(root);
    const manifest = await createRetentionManifest({
      databaseManager,
      debugLogger,
      now: () => fixedNow,
    });
    const displaced = `${mutated}.displaced`;
    fs.renameSync(mutated, displaced);
    fs.writeFileSync(mutated, "replacement with a different identity and size");

    const result = await executeRetentionManifest({
      manifest,
      databaseManager,
      debugLogger,
      deleteVerifiedPath: unlinkVerified,
    });

    expect(result).toMatchObject({ success: false, aborted: true, changed: true });
    expect(databaseManager.deleteRetentionDatabaseSnapshot).not.toHaveBeenCalled();
    expect(unlinkVerified).not.toHaveBeenCalled();
    expect(fs.readFileSync(mutated, "utf8")).toContain("replacement");
    expect(fs.readFileSync(displaced, "utf8")).toBe("original");
    expect(fs.readFileSync(unchanged, "utf8")).toBe("also original");
  });

  it("rejects all deletion when an old database row appears after preview", async () => {
    const root = makeTempRoot();
    const oldLog = path.join(root, "echodraft-debug-2026-06-01.jsonl");
    fs.writeFileSync(oldLog, "old");
    const databaseManager = createDatabaseManager();
    const debugLogger = createDebugLogger(root);
    const manifest = await createRetentionManifest({
      databaseManager,
      debugLogger,
      now: () => fixedNow,
    });
    databaseManager.changeSnapshot();

    const result = await executeRetentionManifest({
      manifest,
      databaseManager,
      debugLogger,
      deleteVerifiedPath: unlinkVerified,
    });

    expect(result).toMatchObject({ success: false, aborted: true, changed: true });
    expect(databaseManager.deleteRetentionDatabaseSnapshot).not.toHaveBeenCalled();
    expect(unlinkVerified).not.toHaveBeenCalled();
    expect(fs.readFileSync(oldLog, "utf8")).toBe("old");
  });

  it("never adds an old log created after preview", async () => {
    const root = makeTempRoot();
    const previewed = path.join(root, "echodraft-debug-2026-06-01.jsonl");
    const addedLater = path.join(root, "echodraft-debug-2026-06-02.jsonl");
    fs.writeFileSync(previewed, "previewed");
    const databaseManager = createDatabaseManager();
    const debugLogger = createDebugLogger(root);
    const manifest = await createRetentionManifest({
      databaseManager,
      debugLogger,
      now: () => fixedNow,
    });
    fs.writeFileSync(addedLater, "added later");

    const result = await executeRetentionManifest({
      manifest,
      databaseManager,
      debugLogger,
      deleteVerifiedPath: unlinkVerified,
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(previewed)).toBe(false);
    expect(fs.readFileSync(addedLater, "utf8")).toBe("added later");
    expect(unlinkVerified).toHaveBeenCalledOnce();
  });

  it("reports database success and exact filesystem residue after a partial file failure", async () => {
    const root = makeTempRoot();
    fs.writeFileSync(path.join(root, "echodraft-debug-2026-06-01.jsonl"), "first");
    fs.writeFileSync(path.join(root, "echodraft-debug-2026-06-02.jsonl"), "second file");
    const databaseManager = createDatabaseManager();
    const debugLogger = createDebugLogger(root);
    const manifest = await createRetentionManifest({
      databaseManager,
      debugLogger,
      now: () => fixedNow,
    });
    let calls = 0;
    const partialDelete = vi.fn(async (_root: string, target: string) => {
      calls += 1;
      if (calls === 2) return { success: false, deleted: false, bytes: 0, error: "locked" };
      const bytes = fs.statSync(target).size;
      fs.unlinkSync(target);
      return { success: true, deleted: true, bytes };
    });

    const result = await executeRetentionManifest({
      manifest,
      databaseManager,
      debugLogger,
      deleteVerifiedPath: partialDelete,
    });

    expect(result).toMatchObject({
      success: false,
      aborted: false,
      database: { success: true, historyDeleted: 1 },
      logs: { success: false, filesDeleted: 1, residualFiles: 1 },
    });
    expect(result.logs.residualBytes).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toMatch(/locked/i);
  });

  it("does not report log success when the verifier removes a file without confirming deletion", async () => {
    const root = makeTempRoot();
    const oldLog = path.join(root, "echodraft-debug-2026-06-01.jsonl");
    fs.writeFileSync(oldLog, "old log");
    const databaseManager = createDatabaseManager();
    const debugLogger = createDebugLogger(root);
    const manifest = await createRetentionManifest({
      databaseManager,
      debugLogger,
      now: () => fixedNow,
    });
    const unconfirmedDelete = vi.fn(async (_root: string, target: string) => {
      fs.unlinkSync(target);
      return { success: true, deleted: false, bytes: 0 };
    });

    const result = await executeRetentionManifest({
      manifest,
      databaseManager,
      debugLogger,
      deleteVerifiedPath: unconfirmedDelete,
    });

    expect(result).toMatchObject({
      success: false,
      aborted: false,
      database: { success: true, historyDeleted: 1 },
      logs: { success: false, filesDeleted: 0, residualFiles: 0 },
    });
    expect(result.errors.join(" ")).toMatch(/did not confirm removal/i);
  });

  it("refuses a linked old log without touching its target", async () => {
    const root = makeTempRoot();
    const outsideRoot = makeTempRoot();
    const outside = path.join(outsideRoot, "outside.jsonl");
    fs.writeFileSync(outside, "outside private data");
    const link = path.join(root, "echodraft-debug-2026-06-01.jsonl");
    try {
      fs.symlinkSync(outside, link, "file");
    } catch {
      return;
    }
    const databaseManager = createDatabaseManager();

    await expect(
      createRetentionManifest({
        databaseManager,
        debugLogger: createDebugLogger(root),
        now: () => fixedNow,
      })
    ).rejects.toThrow(/linked or invalid retention log/i);
    expect(fs.readFileSync(outside, "utf8")).toBe("outside private data");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });
});
