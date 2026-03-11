// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

const {
  getCandidateUserDataPaths,
  getProfileStats,
  isEstablishedProfile,
  migrateUserDataProfile,
  PROFILE_MIGRATION_MARKER,
  selectMigrationSource,
} = require("./userDataProfileMigration");

function writeFile(targetPath: string, content: string | Buffer) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

describe("userDataProfileMigration", () => {
  let tempRoot: string | null = null;

  afterEach(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("includes common Windows profile candidates", () => {
    const appDataPath = "C:\\\\Users\\\\Nigel\\\\AppData\\\\Roaming";
    const currentPath = "C:\\\\Users\\\\Nigel\\\\AppData\\\\Roaming\\\\EchoDraft";
    const candidates = getCandidateUserDataPaths(appDataPath, "win32", currentPath);

    expect(candidates).toContain(path.resolve(currentPath));
    expect(candidates).toContain(path.resolve(path.join(appDataPath, "open-whispr")));
    expect(candidates).toContain(path.resolve(path.join(appDataPath, "echodraft")));
  });

  it("prefers an established legacy profile when the current profile is fresh", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-profile-"));
    const currentPath = path.join(tempRoot, "EchoDraft");
    const sourcePath = path.join(tempRoot, "open-whispr");

    writeFile(path.join(currentPath, ".env"), "DICTATION_KEY_CLIPBOARD=Control+Alt\n");
    writeFile(path.join(currentPath, "transcriptions.db"), Buffer.alloc(20480));
    writeFile(path.join(sourcePath, ".env"), "OPENAI_API_KEY=sk-test\nDICTATION_KEY=F10\n");
    writeFile(path.join(sourcePath, "transcriptions.db"), Buffer.alloc(200000));
    writeFile(
      path.join(sourcePath, "Local Storage", "leveldb", "000003.log"),
      Buffer.alloc(4096)
    );

    const currentStats = getProfileStats(currentPath);
    const sourceStats = getProfileStats(sourcePath);

    expect(isEstablishedProfile(currentStats)).toBe(false);
    expect(isEstablishedProfile(sourceStats)).toBe(true);
    expect(selectMigrationSource(currentStats, [currentStats, sourceStats])?.path).toBe(sourcePath);
  });

  it("copies legacy user data into the current profile before startup", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-profile-copy-"));
    const appDataPath = path.join(tempRoot, "Roaming");
    const currentPath = path.join(appDataPath, "EchoDraft");
    const legacyPath = path.join(appDataPath, "open-whispr");

    writeFile(path.join(currentPath, ".env"), "DICTATION_KEY_CLIPBOARD=Control+Alt\n");
    writeFile(path.join(currentPath, "transcriptions.db"), Buffer.alloc(20480));

    writeFile(path.join(legacyPath, ".env"), "OPENAI_API_KEY=sk-test\nDICTATION_KEY=F10\n");
    writeFile(path.join(legacyPath, "transcriptions.db"), Buffer.alloc(250000));
    writeFile(
      path.join(legacyPath, "Local Storage", "leveldb", "000003.log"),
      "onboardingCompleted=true"
    );
    writeFile(path.join(legacyPath, "Preferences"), "{\"window\":{\"x\":10}}");

    const app = {
      getPath: (name: string) => {
        if (name === "userData") return currentPath;
        if (name === "appData") return appDataPath;
        throw new Error(`Unexpected path request: ${name}`);
      },
    };

    const result = migrateUserDataProfile({ app, platform: "win32", logger: { log: () => {} } });

    expect(result.migrated).toBe(true);
    expect(fs.readFileSync(path.join(currentPath, ".env"), "utf8")).toContain("OPENAI_API_KEY=sk-test");
    expect(fs.readFileSync(path.join(currentPath, "Preferences"), "utf8")).toContain("\"x\":10");
    expect(
      fs.existsSync(path.join(currentPath, "Local Storage", "leveldb", "000003.log"))
    ).toBe(true);
    expect(fs.existsSync(path.join(currentPath, PROFILE_MIGRATION_MARKER))).toBe(true);
  });
});
