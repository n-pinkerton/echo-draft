import { describe, expect, it, vi, beforeEach } from "vitest";

import { safePaste, safePasteWithResult, saveTranscription } from "./audioPersistence";

describe("audioPersistence", () => {
  beforeEach(() => {
    (window as any).electronAPI = {};
  });

  it("safePaste returns true on success", async () => {
    const pasteText = vi.fn(async () => {});
    (window as any).electronAPI = { pasteText };

    const manager: any = { emitError: vi.fn() };
    await expect(safePaste(manager, "hello", {})).resolves.toBe(true);
    expect(manager.emitError).not.toHaveBeenCalled();
  });

  it("safePaste returns false without duplicating the delivery error on failure", async () => {
    const pasteText = vi.fn(async () => {
      throw new Error("nope");
    });
    (window as any).electronAPI = { pasteText };

    const manager: any = { emitError: vi.fn() };
    await expect(safePaste(manager, "hello", {})).resolves.toBe(false);
    expect(manager.emitError).not.toHaveBeenCalled();
  });

  it("safePaste retains a sanitized native failure code for history diagnostics", async () => {
    const pasteText = vi.fn(async () => ({
      success: false,
      errorCode: "WINDOWS_SECURE_PASTE_INPUT_LAYOUT_INVALID",
    }));
    (window as any).electronAPI = { pasteText };

    const manager: any = {};
    await expect(safePasteWithResult(manager, "hello", {})).resolves.toEqual({
      success: false,
      errorCode: "WINDOWS_SECURE_PASTE_INPUT_LAYOUT_INVALID",
    });
  });

  it("preserves a post-insertion clipboard warning as a successful paste outcome", async () => {
    (window as any).electronAPI = {
      pasteText: vi.fn(async () => ({
        success: true,
        inserted: true,
        clipboardRestored: false,
        warningCode: "WINDOWS_CLIPBOARD_RESTORE_FAILED",
      })),
    };

    await expect(safePasteWithResult({}, "hello", {})).resolves.toEqual({
      success: true,
      errorCode: null,
      inserted: true,
      clipboardRestored: false,
      warningCode: "WINDOWS_CLIPBOARD_RESTORE_FAILED",
    });
  });

  it("keeps overlapping paste failure reasons isolated by invocation", async () => {
    const pasteText = vi.fn(async (text: string) => ({
      success: false,
      errorCode: text === "first" ? "MISSING_INSERTION_TARGET" : "INVALID_INSERTION_SESSION",
    }));
    (window as any).electronAPI = { pasteText };

    await expect(
      Promise.all([safePasteWithResult({}, "first", {}), safePasteWithResult({}, "second", {})])
    ).resolves.toEqual([
      { success: false, errorCode: "MISSING_INSERTION_TARGET" },
      { success: false, errorCode: "INVALID_INSERTION_SESSION" },
    ]);
  });

  it("saveTranscription returns ipc result on success", async () => {
    const save = vi.fn(async () => ({ success: true, id: 123 }));
    (window as any).electronAPI = { saveTranscription: save };

    await expect(saveTranscription({ text: "hi" } as any)).resolves.toEqual({
      success: true,
      id: 123,
    });
  });

  it("saveTranscription returns error result on throw", async () => {
    const save = vi.fn(async () => {
      throw new Error("db fail");
    });
    (window as any).electronAPI = { saveTranscription: save };

    const result = await saveTranscription({ text: "hi" } as any);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining("db fail") });
  });
});
