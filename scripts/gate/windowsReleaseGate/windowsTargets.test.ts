// @vitest-environment node
import { spawn } from "child_process";
import { describe, expect, it } from "vitest";

const { closeProcess } = require("./windowsTargets");

const describeOnWindows = process.platform === "win32" ? describe : describe.skip;

describeOnWindows("Windows release gate process cleanup", () => {
  it("terminates and verifies a hidden child process by exact PID", async () => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        "Start-Sleep -Seconds 30",
      ],
      { windowsHide: true }
    );

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    try {
      expect(await closeProcess(child.pid, null, child)).toBe(true);
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      }
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(await closeProcess(child.pid, null, child)).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    }
  }, 15_000);

  it("does not terminate a reused PID when the retained child identity is already closed", async () => {
    const decoy = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        "Start-Sleep -Seconds 30",
      ],
      { windowsHide: true }
    );

    await new Promise<void>((resolve, reject) => {
      decoy.once("spawn", resolve);
      decoy.once("error", reject);
    });

    const staleChildIdentity = {
      pid: decoy.pid,
      exitCode: 0,
      signalCode: null,
    };

    try {
      expect(await closeProcess(decoy.pid, null, staleChildIdentity)).toBe(true);
      expect(decoy.exitCode).toBeNull();
      expect(decoy.signalCode).toBeNull();
    } finally {
      await closeProcess(decoy.pid, null, decoy);
    }
  }, 15_000);
});
