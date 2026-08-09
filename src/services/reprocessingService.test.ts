import { afterEach, describe, expect, it, vi } from "vitest";

import { ReasoningCleanupService } from "../helpers/audio/reasoning/reasoningCleanupService";
import { createReprocessingAction, reprocessStoredItem } from "./reprocessingService";

const originalClipboard = navigator.clipboard;
const originalElectronAPI = (window as any).electronAPI;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
  (window as any).electronAPI = originalElectronAPI;
});

describe("stored raw reprocessing", () => {
  it.each([null, "", "   "])("makes no cleanup request when raw text is %j", async (rawText) => {
    const process = vi.fn();
    const save = vi.fn();
    const copy = vi.fn();
    const reprocess = createReprocessingAction({ process, save, copy } as any);

    await expect(
      reprocess({ id: 7, text: "cleaned", raw_text: rawText } as any, "transcription", "cleanup")
    ).rejects.toMatchObject({ code: "RAW_TRANSCRIPTION_UNAVAILABLE" });
    expect(process).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it("passes the exact stored raw text, saves a linked alternative, and copies only", async () => {
    const process = vi.fn(async () => ({
      text: "Alternative",
      cleanup: { attempted: true, status: "applied", fallbackReason: null },
    }));
    const alternative = {
      id: 3,
      transcription_id: 7,
      mode: "cleanup",
      text: "Alternative",
      created_at: "2026-08-09 00:00:00",
    };
    const save = vi.fn(async () => ({ success: true, alternative }));
    const copy = vi.fn(async () => ({ success: true }));
    const reprocess = createReprocessingAction({ process, save, copy } as any);

    await expect(
      reprocess(
        {
          id: 7,
          text: "Source remains",
          raw_text: "  exact stored raw  ",
          meta: { applicationProcessName: "winword" },
        } as any,
        "transcription",
        "cleanup"
      )
    ).resolves.toEqual({ alternative, copied: true });
    expect(process).toHaveBeenCalledWith("  exact stored raw  ", "cleanup", "winword");
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionId: 7, mode: "cleanup", text: "Alternative" })
    );
    expect(copy).toHaveBeenCalledWith("Alternative");
  });

  it("routes prompt alternatives through the prompt mode without an application style override", async () => {
    const process = vi.fn(async () => ({
      text: "Prompt alternative",
      cleanup: { attempted: true, status: "applied", fallbackReason: null },
    }));
    const save = vi.fn(async () => ({
      success: true,
      alternative: { id: 2, mode: "codex-prompt", text: "Prompt alternative" },
    }));
    const reprocess = createReprocessingAction({
      process,
      save,
      copy: vi.fn(async () => ({ success: true })),
    } as any);

    await reprocess({ id: 9, text: "clean", raw_text: "raw" } as any, "todo", "codex-prompt");
    expect(process).toHaveBeenCalledWith("raw", "codex-prompt", null);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ todoId: 9 }));
  });

  it.each([
    ["not configured", { attempted: false, status: "fallback", fallbackReason: "not_configured" }],
    ["unavailable", { attempted: false, status: "fallback", fallbackReason: "unavailable" }],
    ["provider error", { attempted: true, status: "fallback", fallbackReason: "provider_error" }],
    [
      "fidelity rejection",
      { attempted: true, status: "fallback", fallbackReason: "fidelity_rejected" },
    ],
  ])("does not save or copy a %s fallback", async (_label, cleanup) => {
    const save = vi.fn();
    const copy = vi.fn();
    const reprocess = createReprocessingAction({
      process: vi.fn(async () => ({ text: "raw fallback", cleanup })),
      save,
      copy,
    } as any);

    await expect(
      reprocess({ id: 7, text: "clean", raw_text: "raw" } as any, "transcription", "cleanup")
    ).rejects.toThrow(/accepted alternative/i);
    expect(save).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });

  it("accepts a completed model attempt whose output is unchanged", async () => {
    const save = vi.fn(async () => ({
      success: true,
      alternative: { id: 4, mode: "cleanup", text: "same raw" },
    }));
    const copy = vi.fn(async () => ({ success: true }));
    const reprocess = createReprocessingAction({
      process: vi.fn(async () => ({
        text: "same raw",
        cleanup: { attempted: true, status: "unchanged", fallbackReason: null },
      })),
      save,
      copy,
    } as any);

    await expect(
      reprocess(
        { id: 7, text: "same raw", raw_text: "same raw" } as any,
        "transcription",
        "cleanup"
      )
    ).resolves.toMatchObject({ alternative: { id: 4 }, copied: true });
    expect(save).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledWith("same raw");
  });

  it("uses the control panel's browser clipboard in the real default wiring", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const saveReprocessingAlternative = vi.fn(async () => ({
      success: true,
      alternative: { id: 8, mode: "cleanup", text: "Default alternative" },
    }));
    (window as any).electronAPI = { saveReprocessingAlternative };
    vi.spyOn(
      ReasoningCleanupService.prototype,
      "processTranscriptionWithOutcome"
    ).mockResolvedValue({
      text: "Default alternative",
      cleanup: { attempted: true, status: "applied", fallbackReason: null },
    } as any);

    await expect(
      reprocessStoredItem(
        { id: 11, text: "Original", raw_text: "Exact raw" } as any,
        "transcription",
        "cleanup"
      )
    ).resolves.toMatchObject({ alternative: { id: 8 }, copied: true });
    expect(saveReprocessingAlternative).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("Default alternative");
  });

  it("returns the saved alternative when the real browser clipboard rejects", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("clipboard unavailable");
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const alternative = { id: 12, mode: "cleanup", text: "Saved recovery copy" };
    const saveReprocessingAlternative = vi.fn(async () => ({ success: true, alternative }));
    (window as any).electronAPI = { saveReprocessingAlternative };
    const process = vi
      .spyOn(ReasoningCleanupService.prototype, "processTranscriptionWithOutcome")
      .mockResolvedValue({
        text: "Saved recovery copy",
        cleanup: { attempted: true, status: "applied", fallbackReason: null },
      } as any);

    await expect(
      reprocessStoredItem(
        { id: 7, text: "Original", raw_text: "Exact raw" } as any,
        "transcription",
        "cleanup"
      )
    ).resolves.toEqual({ alternative, copied: false });
    expect(process).toHaveBeenCalledOnce();
    expect(saveReprocessingAlternative).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledOnce();
  });
});
