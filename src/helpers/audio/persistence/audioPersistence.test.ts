import { describe, expect, it, vi, beforeEach } from "vitest";

import { safePaste, saveTranscription } from "./audioPersistence";

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

  it("safePaste returns false and emits error on failure", async () => {
    const pasteText = vi.fn(async () => {
      throw new Error("nope");
    });
    (window as any).electronAPI = { pasteText };

    const manager: any = { emitError: vi.fn() };
    await expect(safePaste(manager, "hello", {})).resolves.toBe(false);
    expect(manager.emitError).toHaveBeenCalledTimes(1);
  });

  it("saveTranscription returns ipc result on success", async () => {
    const save = vi.fn(async () => ({ success: true, id: 123 }));
    (window as any).electronAPI = { saveTranscription: save };

    await expect(saveTranscription({ text: "hi" } as any)).resolves.toEqual({ success: true, id: 123 });
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
