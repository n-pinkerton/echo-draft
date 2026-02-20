import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const { MIN_FILE_SIZE, checkFileExists, checkModelValid } = require("./fileValidation");

describe("modelManagerBridge fileValidation", () => {
  it("checks for existence and minimum size", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "models-"));
    const smallPath = path.join(dir, "small.bin");
    const bigPath = path.join(dir, "big.bin");

    expect(await checkFileExists(smallPath)).toBe(false);

    fs.writeFileSync(smallPath, Buffer.alloc(10));
    expect(await checkFileExists(smallPath)).toBe(true);
    expect(await checkModelValid(smallPath)).toBe(false);

    fs.writeFileSync(bigPath, Buffer.alloc(MIN_FILE_SIZE + 1));
    expect(await checkModelValid(bigPath)).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

