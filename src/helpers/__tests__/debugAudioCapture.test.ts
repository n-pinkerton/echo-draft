import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import debugAudioCapture from "../debugAudioCapture.js";

const { saveDebugAudioCapture, AUDIO_PREFIX, guessExtensionFromMimeType } =
  debugAudioCapture as any;

describe("debugAudioCapture", () => {
  let logsDir: string | null = null;

  afterEach(() => {
    if (logsDir) {
      fs.rmSync(logsDir, { recursive: true, force: true });
      logsDir = null;
    }
  });

  it("enforces a rolling retention of 10 audio captures", () => {
    logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-logs-"));

    const audioBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
    for (let i = 0; i < 12; i += 1) {
      saveDebugAudioCapture({
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
    const audioFiles = files.filter((name) => name.startsWith(AUDIO_PREFIX) && !name.endsWith(".json"));
    const metaFiles = files.filter((name) => name.startsWith(AUDIO_PREFIX) && name.endsWith(".json"));

    expect(audioFiles).toHaveLength(10);
    expect(metaFiles).toHaveLength(10);
  });

  it("guesses extensions from mime types", () => {
    expect(guessExtensionFromMimeType("audio/webm;codecs=opus")).toBe("webm");
    expect(guessExtensionFromMimeType("audio/ogg;codecs=opus")).toBe("ogg");
    expect(guessExtensionFromMimeType("audio/mpeg")).toBe("mp3");
    expect(guessExtensionFromMimeType("audio/wav")).toBe("wav");
  });
});

