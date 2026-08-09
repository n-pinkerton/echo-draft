import { afterEach, describe, expect, it, vi } from "vitest";

import { installE2EHelpers } from "./e2eHelpers";

describe("installE2EHelpers", () => {
  let cleanup: (() => void) | undefined;

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("uses the synthetic text as raw transcription when rawText is omitted", async () => {
    const onTranscriptionComplete = vi.fn(
      async (_completion: Record<string, unknown>) => undefined
    );
    cleanup = installE2EHelpers({
      enabled: true,
      activeSessionRef: { current: null },
      latestProgressRef: { current: null },
      normalizeTriggerPayload: (payload: unknown) => payload,
      onTranscriptionComplete,
      updateStage: vi.fn(),
    });

    await (window as any).__echoDraftE2E.simulateTranscriptionComplete(
      { text: "synthetic result" },
      { outputMode: "clipboard", sessionId: "e2e-session" }
    );

    expect(onTranscriptionComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        text: "synthetic result",
        rawText: "synthetic result",
      })
    );
  });

  it("preserves an explicit null rawText for negative-path checks", async () => {
    const onTranscriptionComplete = vi.fn(
      async (_completion: Record<string, unknown>) => undefined
    );
    cleanup = installE2EHelpers({
      enabled: true,
      activeSessionRef: { current: null },
      latestProgressRef: { current: null },
      normalizeTriggerPayload: (payload: unknown) => payload,
      onTranscriptionComplete,
      updateStage: vi.fn(),
    });

    await (window as any).__echoDraftE2E.simulateTranscriptionComplete({
      text: "synthetic result",
      rawText: null,
    });

    expect(onTranscriptionComplete.mock.calls[0][0]).not.toHaveProperty("rawText");
  });
});
