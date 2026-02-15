// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const { TelemetryFileLogger, getLocalDateKey } = require("../telemetryFileLogger");

describe("TelemetryFileLogger", () => {
  it("writes a header once per new daily file and appends JSONL records", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-telemetry-"));

    let now = new Date(2026, 1, 12, 8, 0, 0);
    const dateKey = getLocalDateKey(now);

    const logger = new TelemetryFileLogger({
      logsDir: tempDir,
      filePrefix: "openwhispr-test",
      getNow: () => now,
      getHeaderRecord: () => ({ type: "header", marker: true }),
    });

    logger.setEnabled(true);
    expect(logger.write({ type: "event", n: 1 })).toBe(true);
    expect(await logger.flush()).toBe(true);

    const logPath = path.join(tempDir, `openwhispr-test-${dateKey}.jsonl`);
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
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-telemetry-rotate-"));

    let now = new Date(2026, 1, 12, 23, 50, 0);
    const logger = new TelemetryFileLogger({
      logsDir: tempDir,
      filePrefix: "openwhispr-test",
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
      `openwhispr-test-${getLocalDateKey(new Date(2026, 1, 12))}.jsonl`
    );
    const day2 = path.join(
      tempDir,
      `openwhispr-test-${getLocalDateKey(new Date(2026, 1, 13))}.jsonl`
    );

    const c1 = fs.readFileSync(day1, "utf8").trim().split("\n");
    const c2 = fs.readFileSync(day2, "utf8").trim().split("\n");
    expect(JSON.parse(c1[0]).type).toBe("header");
    expect(JSON.parse(c1[1])).toMatchObject({ type: "event", day: "1" });
    expect(JSON.parse(c2[0]).type).toBe("header");
    expect(JSON.parse(c2[1])).toMatchObject({ type: "event", day: "2" });
  });

  it("recreates the daily log file if it is deleted while running", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-telemetry-recreate-"));

    const now = new Date(2026, 1, 12, 12, 0, 0);
    const dateKey = getLocalDateKey(now);

    const logger = new TelemetryFileLogger({
      logsDir: tempDir,
      filePrefix: "openwhispr-test",
      getNow: () => now,
      getHeaderRecord: () => ({ type: "header", marker: "recreate" }),
    });

    logger.setEnabled(true);
    expect(logger.write({ type: "event", n: 1 })).toBe(true);
    expect(await logger.flush()).toBe(true);

    const logPath = path.join(tempDir, `openwhispr-test-${dateKey}.jsonl`);
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
});
