// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const { waitForEvaluation } = require("./stageAndEcho");

describe("Windows release gate stage polling", () => {
  it("accepts a delayed matching value", async () => {
    const target = {
      eval: vi
        .fn()
        .mockResolvedValueOnce({ stage: "idle" })
        .mockResolvedValueOnce({ stage: "listening" }),
    };
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForEvaluation(target, "stage expression", (value) => value?.stage === "listening", {
        timeoutMs: 300,
        intervalMs: 100,
        sleepFn,
      })
    ).resolves.toEqual({
      matched: true,
      attempts: 2,
      value: { stage: "listening" },
      error: null,
    });
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });

  it("returns bounded diagnostic evidence when the condition never matches", async () => {
    const target = { eval: vi.fn().mockResolvedValue({ visible: false }) };
    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForEvaluation(target, "window expression", (value) => value?.visible === true, {
        timeoutMs: 250,
        intervalMs: 100,
        sleepFn,
      })
    ).resolves.toEqual({
      matched: false,
      attempts: 4,
      value: { visible: false },
      error: null,
    });
    expect(target.eval).toHaveBeenCalledTimes(4);
    expect(sleepFn).toHaveBeenCalledTimes(3);
  });
});
