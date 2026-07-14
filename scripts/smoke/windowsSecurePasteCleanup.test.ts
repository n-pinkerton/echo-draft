import { describe, expect, it, vi } from "vitest";

const {
  CLEANUP_STEPS,
  clipboardSnapshotsMatch,
  fingerprintClipboardSnapshot,
  isVerifiedSmokeResult,
  runWithIndependentCleanup,
  sameInsertionTargetIdentity,
} = require("./windowsSecurePasteCleanup.cjs");

const createCleanupSteps = () =>
  Object.fromEntries(CLEANUP_STEPS.map((stepName: string) => [stepName, vi.fn(() => true)]));

describe("secure Windows paste smoke cleanup", () => {
  it("fingerprints clipboard contents without retaining their values", () => {
    const canary = "PRIVATE-CLIPBOARD-CANARY-9a3d";
    const snapshot = {
      text: canary,
      html: `<b>${canary}</b>`,
      rtf: `{\\rtf1 ${canary}}`,
      imagePng: Buffer.from(canary),
      formats: [{ format: "application/x-canary", buffer: Buffer.from(canary) }],
    };
    const reorderedSnapshot = { ...snapshot, formats: [...snapshot.formats].reverse() };

    expect(clipboardSnapshotsMatch(snapshot, reorderedSnapshot)).toBe(true);
    expect(JSON.stringify(fingerprintClipboardSnapshot(snapshot))).not.toContain(canary);
  });

  it("recognizes the same authenticated insertion target", () => {
    const target = { hwnd: 42, pid: 73, processStartTimeUtcTicks: "638100000000000000" };
    expect(sameInsertionTargetIdentity(target, { ...target, title: "changed" })).toBe(true);
    expect(sameInsertionTargetIdentity(target, { ...target, pid: 74 })).toBe(false);
  });

  it("runs every cleanup step after the paste operation fails", async () => {
    const cleanupSteps = createCleanupSteps();
    const pasteError = new Error("injected paste failure");

    const result = await runWithIndependentCleanup(async () => {
      throw pasteError;
    }, cleanupSteps);

    expect(result.operationError).toBe(pasteError);
    expect(result.cleanup).toEqual({ success: true, failures: [] });
    for (const stepName of CLEANUP_STEPS) {
      expect(cleanupSteps[stepName]).toHaveBeenCalledTimes(1);
    }
  });

  it.each(["restoreClipboard", "destroyWindow", "restoreForeground"])(
    "continues all cleanup checks when %s fails",
    async (failingStep) => {
      const cleanupSteps = createCleanupSteps();
      cleanupSteps[failingStep].mockImplementation(() => {
        throw new Error("injected cleanup failure");
      });

      const result = await runWithIndependentCleanup(async () => "pasted", cleanupSteps);

      expect(result.operationResult).toBe("pasted");
      expect(result.cleanup).toEqual({ success: false, failures: [failingStep] });
      for (const stepName of CLEANUP_STEPS) {
        expect(cleanupSteps[stepName]).toHaveBeenCalledTimes(1);
      }
    }
  );

  it("times out one hung cleanup step and still runs every later step", async () => {
    const cleanupSteps = createCleanupSteps();
    cleanupSteps.restoreForeground.mockImplementation(() => new Promise(() => {}));

    const result = await runWithIndependentCleanup(async () => "pasted", cleanupSteps, {
      stepTimeoutMs: 10,
    });

    expect(result.cleanup).toEqual({
      success: false,
      failures: ["restoreForeground"],
    });
    expect(cleanupSteps.verifyClipboard).toHaveBeenCalledTimes(1);
    expect(cleanupSteps.verifyForeground).toHaveBeenCalledTimes(1);
  });

  it("aborts a hung operation and always enters cleanup", async () => {
    const cleanupSteps = createCleanupSteps();
    const cancelOperation = vi.fn(() => true);
    let operationSignal: AbortSignal | null = null;

    const result = await runWithIndependentCleanup(
      (signal: AbortSignal) => {
        operationSignal = signal;
        return new Promise(() => {});
      },
      cleanupSteps,
      { cancelOperation, operationTimeoutMs: 10 }
    );

    expect(result.operationError).toMatchObject({
      code: "WINDOWS_PASTE_SMOKE_OPERATION_TIMEOUT",
    });
    expect(operationSignal?.aborted).toBe(true);
    expect(cancelOperation).toHaveBeenCalledTimes(1);
    expect(result.cleanup).toEqual({ success: true, failures: [] });
    for (const stepName of CLEANUP_STEPS) {
      expect(cleanupSteps[stepName]).toHaveBeenCalledTimes(1);
    }
  });

  it("accepts only results that prove restoration and foreground recovery", () => {
    expect(
      isVerifiedSmokeResult({
        success: true,
        userStateRestored: true,
        foregroundRecoveryExercised: true,
        stackedInsertionsVerified: true,
        insertedJobs: 2,
      })
    ).toBe(true);
    expect(isVerifiedSmokeResult({ success: true, foregroundRecoveryExercised: true })).toBe(false);
    expect(isVerifiedSmokeResult({ success: true, userStateRestored: true })).toBe(false);
    expect(
      isVerifiedSmokeResult({
        success: true,
        userStateRestored: true,
        foregroundRecoveryExercised: true,
        stackedInsertionsVerified: false,
        insertedJobs: 2,
      })
    ).toBe(false);
  });
});
