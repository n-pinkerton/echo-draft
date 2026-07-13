import { describe, expect, it, vi } from "vitest";

import TrayManagerModule from "./tray.js";

const TrayManager = TrayManagerModule as any;

describe("TrayManager recovery copy", () => {
  it("copies the in-memory failed transcript instead of an older saved database row", async () => {
    const writeClipboard = vi.fn(async () => ({ success: true }));
    const trayManager = new TrayManager({
      clipboardManager: { writeClipboard },
      databaseManager: {
        getLatestTranscription: () => ({
          id: 1,
          timestamp: "2026-07-11T00:00:00.000Z",
          text: "Older saved dictation",
        }),
      },
    });

    trayManager.updateDictationStatus({
      stage: "done",
      stageLabel: "Done",
      message: "Automatic text delivery failed.",
      hasTranscript: true,
      transcriptToCopy: "Newest unsaved dictation",
    });
    await trayManager.copyLastTranscription();

    expect(writeClipboard).toHaveBeenCalledWith("Newest unsaved dictation");
    const copyItem = trayManager
      .buildContextMenuTemplate()
      .find((item: any) => item.label === "Copy Last Dictation");
    expect(copyItem?.enabled).toBe(true);
  });
});
