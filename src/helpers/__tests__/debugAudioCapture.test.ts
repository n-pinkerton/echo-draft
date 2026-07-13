import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import debugAudioCapture from "../debugAudioCapture.js";

const { saveDebugAudioCapture, enforceRetention, AUDIO_PREFIX, guessExtensionFromMimeType } =
  debugAudioCapture as any;

describe("debugAudioCapture", () => {
  let logsDir: string | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    if (logsDir) {
      fs.rmSync(logsDir, { recursive: true, force: true });
      logsDir = null;
    }
  });

  it("enforces a rolling retention of 10 audio captures", async () => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-logs-"));

    const audioBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
    for (let i = 0; i < 12; i += 1) {
      await saveDebugAudioCapture({
        logsDir,
        audioBuffer,
        mimeType: "audio/webm;codecs=opus",
        sessionId: `session-${i}`,
        jobId: i,
        outputMode: "clipboard",
        durationSeconds: 1.23,
      });
    }

    const audioDir = path.join(logsDir, "audio");
    const files = fs.readdirSync(audioDir);
    const audioFiles = files.filter(
      (name) => name.startsWith(AUDIO_PREFIX) && !name.endsWith(".json")
    );
    const metaFiles = files.filter(
      (name) => name.startsWith(AUDIO_PREFIX) && name.endsWith(".json")
    );

    expect(audioFiles).toHaveLength(10);
    expect(metaFiles).toHaveLength(10);
  }, 60_000);

  it("also caps retained capture bytes", async () => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-logs-"));
    const audioBuffer = new Uint8Array(256).buffer;
    for (let i = 0; i < 4; i += 1) {
      await saveDebugAudioCapture({
        logsDir,
        audioBuffer,
        mimeType: "audio/webm",
        sessionId: `session-${i}`,
        maxCaptures: 10,
        maxTotalBytes: 700,
      });
    }

    const audioDir = path.join(logsDir, "audio");
    const files = fs
      .readdirSync(audioDir)
      .filter((name) => name.startsWith(AUDIO_PREFIX) && !name.endsWith(".json"));
    const totalBytes = fs
      .readdirSync(audioDir)
      .reduce((sum, name) => sum + fs.statSync(path.join(audioDir, name)).size, 0);
    expect(files.length).toBeLessThan(4);
    expect(totalBytes).toBeLessThanOrEqual(700);
  }, 20_000);

  it("rejects oversized payloads before writing files", async () => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-logs-"));
    await expect(
      saveDebugAudioCapture({
        logsDir,
        audioBuffer: new Uint8Array(5).buffer,
        mimeType: "audio/webm",
        maxAudioBytes: 4,
      })
    ).rejects.toThrow(/size limit/i);
    expect(fs.existsSync(path.join(logsDir, "audio"))).toBe(false);
  });

  it("refuses an audio directory junction instead of writing outside the logs root", async () => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-logs-linked-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-audio-outside-"));
    const audioDir = path.join(logsDir, "audio");
    try {
      fs.symlinkSync(outsideDir, audioDir, process.platform === "win32" ? "junction" : "dir");
    } catch {
      fs.rmSync(outsideDir, { recursive: true, force: true });
      return;
    }

    try {
      await expect(
        saveDebugAudioCapture({
          logsDir,
          audioBuffer: new Uint8Array([1, 2, 3, 4]).buffer,
          mimeType: "audio/webm",
          sessionId: "session-linked",
        })
      ).rejects.toThrow(/linked|resolved outside/i);
      expect(fs.readdirSync(outsideDir)).toEqual([]);
    } finally {
      if (process.platform === "win32") fs.rmdirSync(audioDir);
      else fs.unlinkSync(audioDir);
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("writes no private audio when the retained audio pathname is swapped before temp open", async () => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-logs-swap-"));
    const audioDir = path.join(logsDir, "audio");
    const retainedAudioDir = path.join(logsDir, "retained-audio");
    const marker = Buffer.from("SENSITIVE_AUDIO_SWAP_MARKER", "utf8");
    const realOpen = fs.promises.open.bind(fs.promises);
    let swapped = false;
    vi.spyOn(fs.promises, "open").mockImplementation(async (target: any, flags: any, mode?: any) => {
      if (!swapped && String(target).endsWith(".tmp")) {
        fs.renameSync(audioDir, retainedAudioDir);
        fs.mkdirSync(audioDir);
        swapped = true;
      }
      return await realOpen(target, flags, mode);
    });

    await expect(
      saveDebugAudioCapture({
        logsDir,
        audioBuffer: marker,
        mimeType: "audio/webm",
        sessionId: "session-swap",
      })
    ).rejects.toThrow(/changed|handle|verified/i);

    expect(swapped).toBe(true);
    for (const directory of [audioDir, retainedAudioDir]) {
      for (const name of fs.readdirSync(directory)) {
        expect(fs.readFileSync(path.join(directory, name)).includes(marker)).toBe(false);
      }
    }
  });

  it("keeps the verified temp handle through publication and erases a replaced temp file", async () => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-logs-temp-publish-swap-"));
    const marker = Buffer.from("SENSITIVE_AUDIO_PUBLICATION_MARKER", "utf8");
    const realLink = fs.promises.link.bind(fs.promises);
    let swapped = false;
    let displacedPath = "";
    vi.spyOn(fs.promises, "link").mockImplementation(async (source: any, destination: any) => {
      if (!swapped && String(source).endsWith(".tmp")) {
        displacedPath = `${String(source)}.displaced`;
        await fs.promises.rename(source, displacedPath);
        await fs.promises.writeFile(source, "replacement-owned-by-another-writer");
        swapped = true;
      }
      return await realLink(source, destination);
    });

    await expect(
      saveDebugAudioCapture({
        logsDir,
        audioBuffer: marker,
        mimeType: "audio/webm",
        sessionId: "session-temp-publication-swap",
      })
    ).rejects.toThrow(/changed|publication|temporary|output/i);

    expect(swapped).toBe(true);
    expect(fs.existsSync(displacedPath)).toBe(true);
    expect(fs.readFileSync(displacedPath).includes(marker)).toBe(false);
    const audioDir = path.join(logsDir, "audio");
    for (const name of fs.readdirSync(audioDir)) {
      if (name.endsWith(".webm") || name.endsWith(".json")) {
        expect(fs.readFileSync(path.join(audioDir, name)).includes(marker)).toBe(false);
      }
    }
  });

  it("publishes no private bytes when the retained audio parent becomes a junction", async () => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-logs-parent-publish-swap-"));
    const audioDir = path.join(logsDir, "audio");
    const retainedAudioDir = path.join(logsDir, "retained-audio");
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-audio-publish-outside-"));
    const marker = Buffer.from("SENSITIVE_AUDIO_PARENT_SWAP_MARKER", "utf8");
    const realLink = fs.promises.link.bind(fs.promises);
    let swapped = false;
    let swapPreventedByOpenHandle = false;
    vi.spyOn(fs.promises, "link").mockImplementation(async (source: any, destination: any) => {
      if (!swapped && String(source).endsWith(".tmp")) {
        try {
          fs.renameSync(audioDir, retainedAudioDir);
        } catch (error: any) {
          if (["EACCES", "EBUSY", "EPERM"].includes(error?.code)) {
            swapPreventedByOpenHandle = true;
          }
          throw error;
        }
        fs.symlinkSync(outsideDir, audioDir, process.platform === "win32" ? "junction" : "dir");
        swapped = true;
      }
      return await realLink(source, destination);
    });

    try {
      let failure: unknown = null;
      try {
        await saveDebugAudioCapture({
          logsDir,
          audioBuffer: marker,
          mimeType: "audio/webm",
          sessionId: "session-parent-publication-swap",
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(Error);
      expect(
        swapped || swapPreventedByOpenHandle,
        failure instanceof Error ? failure.message : String(failure)
      ).toBe(true);
      expect(fs.readdirSync(outsideDir)).toEqual([]);
      if (swapped) {
        for (const name of fs.readdirSync(retainedAudioDir)) {
          expect(fs.readFileSync(path.join(retainedAudioDir, name)).includes(marker)).toBe(false);
        }
      }
    } finally {
      if (swapped && fs.existsSync(audioDir)) {
        if (process.platform === "win32") fs.rmdirSync(audioDir);
        else fs.unlinkSync(audioDir);
      }
      if (fs.existsSync(retainedAudioDir)) fs.renameSync(retainedAudioDir, audioDir);
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it(
    "keeps the audio handle until metadata publication and scrubs the pair after a parent swap",
    async () => {
      logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-logs-pair-swap-"));
      const audioDir = path.join(logsDir, "audio");
      const retainedAudioDir = path.join(logsDir, "retained-audio");
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-pair-swap-outside-"));
      const marker = Buffer.from("SENSITIVE_AUDIO_PAIR_TRANSACTION_MARKER", "utf8");
      const realOpen = fs.promises.open.bind(fs.promises);
      let metadataOpenAttempted = false;
      let swapped = false;
      let swapPreventedByOpenHandle = false;
      vi.spyOn(fs.promises, "open").mockImplementation(async (target: any, flags: any, mode?: any) => {
        const targetPath = String(target);
        if (
          !metadataOpenAttempted &&
          targetPath.endsWith(".tmp") &&
          path.basename(targetPath).includes(".json.")
        ) {
          metadataOpenAttempted = true;
          try {
            fs.renameSync(audioDir, retainedAudioDir);
          } catch (error: any) {
            if (["EACCES", "EBUSY", "EPERM"].includes(error?.code)) {
              swapPreventedByOpenHandle = true;
            }
            throw error;
          }
          fs.symlinkSync(outsideDir, audioDir, process.platform === "win32" ? "junction" : "dir");
          swapped = true;
        }
        return await realOpen(target, flags, mode);
      });

      try {
        await expect(
          saveDebugAudioCapture({
            logsDir,
            audioBuffer: marker,
            mimeType: "audio/webm",
            sessionId: "session-pair-swap",
          })
        ).rejects.toThrow(/changed|handle|verified|busy|permission|EPERM|operation not permitted/i);

        expect(metadataOpenAttempted).toBe(true);
        expect(swapped || swapPreventedByOpenHandle).toBe(true);
        for (const directory of [retainedAudioDir, outsideDir, audioDir]) {
          if (!fs.existsSync(directory) || fs.lstatSync(directory).isSymbolicLink()) continue;
          for (const name of fs.readdirSync(directory)) {
            const candidate = path.join(directory, name);
            if (!fs.statSync(candidate).isFile()) continue;
            const residual = fs.readFileSync(candidate);
            expect(residual.includes(marker)).toBe(false);
            if (name.includes(".webm")) expect(residual.length).toBe(0);
          }
        }
      } finally {
        if (swapped && fs.existsSync(audioDir)) {
          if (process.platform === "win32") fs.rmdirSync(audioDir);
          else fs.unlinkSync(audioDir);
        }
        if (fs.existsSync(retainedAudioDir)) fs.renameSync(retainedAudioDir, audioDir);
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    },
    60_000
  );

  it("does not delete a capture pathname replaced after retention enumeration", async () => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "echodraft-logs-retention-swap-"));
    const audioDir = path.join(logsDir, "audio");
    fs.mkdirSync(audioDir);
    const oldAudio = path.join(audioDir, `${AUDIO_PREFIX}old.webm`);
    const oldMeta = path.join(audioDir, `${AUDIO_PREFIX}old.json`);
    const newAudio = path.join(audioDir, `${AUDIO_PREFIX}new.webm`);
    const newMeta = path.join(audioDir, `${AUDIO_PREFIX}new.json`);
    fs.writeFileSync(oldAudio, "original-old-audio");
    fs.writeFileSync(oldMeta, "original-old-meta");
    fs.writeFileSync(newAudio, "new-audio");
    fs.writeFileSync(newMeta, "new-meta");
    const oldTime = new Date(Date.now() - 60_000);
    fs.utimesSync(oldAudio, oldTime, oldTime);
    fs.utimesSync(oldMeta, oldTime, oldTime);

    const displaced = path.join(audioDir, "displaced-old.webm");
    const marker = "SENSITIVE_REPLACEMENT_MARKER";
    const realLstat = fs.promises.lstat.bind(fs.promises);
    let oldAudioChecks = 0;
    vi.spyOn(fs.promises, "lstat").mockImplementation(async (target: any, options?: any) => {
      if (path.resolve(String(target)) === path.resolve(oldAudio)) {
        oldAudioChecks += 1;
        if (oldAudioChecks === 2) {
          fs.renameSync(oldAudio, displaced);
          fs.writeFileSync(oldAudio, marker);
        }
      }
      return await realLstat(target, options);
    });

    const rootHandle = await fs.promises.open(audioDir, "r");
    try {
      const expectedRootStat = await rootHandle.stat({ bigint: true });
      await enforceRetention(audioDir, 1, 1024 * 1024, {
        root: audioDir,
        expectedRootStat,
        rootHandle,
        windowsRootIdentity: {
          volumeSerialNumber: String(expectedRootStat.dev),
          fileIndex: String(expectedRootStat.ino),
        },
      });
    } finally {
      await rootHandle.close();
    }

    expect(fs.readFileSync(oldAudio, "utf8")).toBe(marker);
    expect(fs.readFileSync(displaced, "utf8")).toBe("original-old-audio");
  });

  it("guesses extensions from mime types", () => {
    expect(guessExtensionFromMimeType("audio/webm;codecs=opus")).toBe("webm");
    expect(guessExtensionFromMimeType("audio/ogg;codecs=opus")).toBe("ogg");
    expect(guessExtensionFromMimeType("audio/mpeg")).toBe("mp3");
    expect(guessExtensionFromMimeType("audio/wav")).toBe("wav");
  });
});
