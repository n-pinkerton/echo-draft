import { describe, expect, it, vi } from "vitest";

import { closeTargetWithRetry, isForegroundAutomationAllowed } from "./runWindowsReleaseGate.js";

describe("Windows release gate safety mode", () => {
  it("disables foreground automation by default", () => {
    expect(isForegroundAutomationAllowed([], {})).toBe(false);
  });

  it("requires an explicit command-line or environment opt-in", () => {
    expect(isForegroundAutomationAllowed(["--allow-foreground-automation"], {})).toBe(true);
    expect(
      isForegroundAutomationAllowed([], {
        OPENWHISPR_GATE_ALLOW_FOREGROUND_AUTOMATION: "true",
      })
    ).toBe(true);
  });

  it("retries a failed target close and succeeds only after verification", async () => {
    const closeTarget = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const delay = vi.fn().mockResolvedValue(undefined);

    await expect(
      closeTargetWithRetry(
        { pid: 123 },
        {
          closeTarget,
          delay,
          attempts: 2,
        }
      )
    ).resolves.toBe(true);
    expect(closeTarget).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it("reports a persistent target-close failure", async () => {
    const closeTarget = vi.fn().mockResolvedValue(false);

    await expect(
      closeTargetWithRetry(
        { pid: 123 },
        {
          closeTarget,
          delay: vi.fn().mockResolvedValue(undefined),
          attempts: 2,
        }
      )
    ).resolves.toBe(false);
    expect(closeTarget).toHaveBeenCalledTimes(2);
  });
});
