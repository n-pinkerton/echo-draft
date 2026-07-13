// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const { TelemetryFileLogger, getLocalDateKey } = require("../telemetryFileLogger");

describe("TelemetryFileLogger", () => {
  it("writes a header once per new daily file and appends JSONL records", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-telemetry-"));

    let now = new Date(2026, 1, 12, 8, 0, 0);
    const dateKey = getLocalDateKey(now);

    const logger = new TelemetryFileLogger({
      logsDir: tempDir,
      filePrefix: "echodraft-test",
      getNow: () => now,
      getHeaderRecord: () => ({ type: "header", marker: true }),
    });

    logger.setEnabled(true);
    expect(logger.write({ type: "event", n: 1 })).toBe(true);
    expect(await logger.flush()).toBe(true);

    const logPath = path.join(tempDir, `echodraft-test-${dateKey}.jsonl`);
    const content = fs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(content.length).toBe(2);
    expect(JSON.parse(content[0])).toMatchObject({ type: "header", marker: true });
    expect(JSON.parse(content[1])).toMatchObject({ type: "event", n: 1 });

    // Same day: no new header line.
    expect(logger.write({ type: "event", n: 2 })).toBe(true);
    expect(await logger.flush()).toBe(true);
    const content2 = fs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(content2.length).toBe(3);
    expect(JSON.parse(content2[0]).type).toBe("header");
    expect(JSON.parse(content2[1]).n).toBe(1);
    expect(JSON.parse(content2[2]).n).toBe(2);
  });

  it("rotates to a new file when the local date changes", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-telemetry-rotate-"));

    let now = new Date(2026, 1, 12, 23, 50, 0);
    const logger = new TelemetryFileLogger({
      logsDir: tempDir,
      filePrefix: "echodraft-test",
      getNow: () => now,
      getHeaderRecord: () => ({ type: "header" }),
    });

    logger.setEnabled(true);
    expect(logger.write({ type: "event", day: "1" })).toBe(true);
    expect(await logger.flush()).toBe(true);

    // Advance to the next day.
    now = new Date(2026, 1, 13, 0, 10, 0);
    expect(logger.write({ type: "event", day: "2" })).toBe(true);
    expect(await logger.flush()).toBe(true);

    const day1 = path.join(
      tempDir,
      `echodraft-test-${getLocalDateKey(new Date(2026, 1, 12))}.jsonl`
    );
    const day2 = path.join(
      tempDir,
      `echodraft-test-${getLocalDateKey(new Date(2026, 1, 13))}.jsonl`
    );

    const c1 = fs.readFileSync(day1, "utf8").trim().split("\n");
    const c2 = fs.readFileSync(day2, "utf8").trim().split("\n");
    expect(JSON.parse(c1[0]).type).toBe("header");
    expect(JSON.parse(c1[1])).toMatchObject({ type: "event", day: "1" });
    expect(JSON.parse(c2[0]).type).toBe("header");
    expect(JSON.parse(c2[1])).toMatchObject({ type: "event", day: "2" });
  });

  it("recreates the daily log file if it is deleted while running", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-telemetry-recreate-"));

    const now = new Date(2026, 1, 12, 12, 0, 0);
    const dateKey = getLocalDateKey(now);

    const logger = new TelemetryFileLogger({
      logsDir: tempDir,
      filePrefix: "echodraft-test",
      getNow: () => now,
      getHeaderRecord: () => ({ type: "header", marker: "recreate" }),
    });

    logger.setEnabled(true);
    expect(logger.write({ type: "event", n: 1 })).toBe(true);
    expect(await logger.flush()).toBe(true);

    const logPath = path.join(tempDir, `echodraft-test-${dateKey}.jsonl`);
    expect(fs.existsSync(logPath)).toBe(true);

    fs.unlinkSync(logPath);
    expect(fs.existsSync(logPath)).toBe(false);

    expect(logger.write({ type: "event", n: 2 })).toBe(true);
    expect(await logger.flush()).toBe(true);

    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(content.length).toBe(2);
    expect(JSON.parse(content[0])).toMatchObject({ type: "header", marker: "recreate" });
    expect(JSON.parse(content[1])).toMatchObject({ type: "event", n: 2 });
  });

  it("keeps sustained maximum-rate logging within per-file, directory, and retention caps", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-telemetry-bounded-"));
    const logger = new TelemetryFileLogger({
      logsDir: tempDir,
      filePrefix: "echodraft-test",
      getNow: () => new Date(2026, 1, 12, 12, 0, 0),
      getHeaderRecord: () => ({ type: "header" }),
      maxFileBytes: 320,
      maxTotalBytes: 800,
      maxFiles: 3,
      maxRecordBytes: 160,
      maxPendingBytes: 1024 * 1024,
      // This test exercises accounting under hundreds of intentionally tiny
      // rotations. Native Windows identity/deletion is covered separately.
      platform: "linux",
    });
    logger.setEnabled(true);

    for (let index = 0; index < 1000; index += 1) {
      logger.write({ type: "event", index, message: "x".repeat(48) });
    }
    await logger.closeAndWait();

    await vi.waitFor(() => {
      const files = fs.readdirSync(tempDir).filter((name) => name.endsWith(".jsonl"));
      const sizes = files.map((name) => fs.statSync(path.join(tempDir, name)).size);
      expect(files.length).toBeLessThanOrEqual(3);
      expect(sizes.every((size) => size <= 320)).toBe(true);
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(800);
    });
  });

  it("fails closed without throwing when the stream reports a disk-full error", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-telemetry-disk-full-"));
    const logger = new TelemetryFileLogger({
      logsDir: tempDir,
      filePrefix: "echodraft-test",
      getNow: () => new Date(2026, 1, 12, 12, 0, 0),
    });
    logger.setEnabled(true);
    expect(logger.write({ type: "event", index: 1 })).toBe(true);

    expect(() =>
      logger.stream.emit("error", Object.assign(new Error("disk full"), { code: "ENOSPC" }))
    ).not.toThrow();
    expect(logger.write({ type: "event", index: 2 })).toBe(false);
    expect(logger.stream).toBeNull();
  });

  it("rejects a pre-existing linked logs folder without writing outside it", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-telemetry-link-parent-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-telemetry-link-outside-"));
    const logsDir = path.join(parent, "logs");
    try {
      fs.symlinkSync(outside, logsDir, process.platform === "win32" ? "junction" : "dir");
    } catch {
      fs.rmSync(parent, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
      return;
    }

    const logger = new TelemetryFileLogger({ logsDir, filePrefix: "echodraft-test" });
    logger.setEnabled(true);
    expect(logger.write({ marker: "SENSITIVE_LINK_MARKER" })).toBe(false);
    logger.setEnabled(false);

    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("writes no sensitive record when the retained logs pathname is swapped immediately before open", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-telemetry-swap-"));
    const logsDir = path.join(parent, "logs");
    const displaced = path.join(parent, "retained-logs");
    fs.mkdirSync(logsDir);
    const realOpenSync = fs.openSync.bind(fs);
    let swapped = false;
    vi.spyOn(fs, "openSync").mockImplementation(((target: fs.PathLike, flags: any, mode?: any) => {
      if (!swapped && String(target).endsWith(".jsonl")) {
        fs.renameSync(logsDir, displaced);
        fs.mkdirSync(logsDir);
        swapped = true;
      }
      return realOpenSync(target, flags, mode);
    }) as typeof fs.openSync);

    const logger = new TelemetryFileLogger({
      logsDir,
      filePrefix: "echodraft-test",
      getNow: () => new Date(2026, 1, 12, 12, 0, 0),
    });
    logger.setEnabled(true);
    expect(logger.write({ marker: "SENSITIVE_SWAP_MARKER" })).toBe(false);
    logger.setEnabled(false);

    expect(swapped).toBe(true);
    for (const directory of [logsDir, displaced]) {
      for (const name of fs.readdirSync(directory)) {
        expect(fs.readFileSync(path.join(directory, name), "utf8")).not.toContain(
          "SENSITIVE_SWAP_MARKER"
        );
      }
    }
    fs.rmSync(parent, { recursive: true, force: true });
  });
});
