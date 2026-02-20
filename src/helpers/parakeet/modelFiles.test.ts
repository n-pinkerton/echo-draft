import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const { isParakeetModelDownloaded, REQUIRED_PARAKEET_FILES } = require("./modelFiles");

describe("parakeet modelFiles", () => {
  it("returns false when model dir is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parakeet-models-"));
    expect(isParakeetModelDownloaded(dir, "missing-model")).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns false when any required file is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parakeet-models-"));
    const modelName = "test-model";
    const modelDir = path.join(dir, modelName);
    fs.mkdirSync(modelDir, { recursive: true });

    fs.writeFileSync(path.join(modelDir, REQUIRED_PARAKEET_FILES[0]), "");
    expect(isParakeetModelDownloaded(dir, modelName)).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns true when all required files exist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parakeet-models-"));
    const modelName = "test-model";
    const modelDir = path.join(dir, modelName);
    fs.mkdirSync(modelDir, { recursive: true });

    for (const file of REQUIRED_PARAKEET_FILES) {
      fs.writeFileSync(path.join(modelDir, file), "");
    }

    expect(isParakeetModelDownloaded(dir, modelName)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

