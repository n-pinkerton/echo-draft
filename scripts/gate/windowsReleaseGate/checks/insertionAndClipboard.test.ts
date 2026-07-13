// @vitest-environment node
import { describe, expect, it } from "vitest";

const { isClipboardFallbackTrayStatus } = require("./insertionAndClipboard");

describe("Windows release gate clipboard-fallback status check", () => {
  it("accepts a truthful warning with actionable clipboard detail", () => {
    expect(
      isClipboardFallbackTrayStatus({
        stage: "warning",
        stageLabel: "Delivered with warning",
        message: "Insert failed; text kept in clipboard.",
        statusLabel: "Status: Delivered with warning",
      })
    ).toBe(true);
  });

  it.each([
    { stage: "done", stageLabel: "Done" },
    { stage: "warning", stageLabel: "Delivered with warning", message: "Saved." },
    {
      stage: "warning",
      stageLabel: "Delivered with warning",
      message: "Insert failed; text kept in clipboard.",
      statusLabel: "Status: Done",
    },
  ])("rejects a false or incomplete terminal state", (status) => {
    expect(isClipboardFallbackTrayStatus(status)).toBe(false);
  });
});
