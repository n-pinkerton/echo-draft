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

  it("shows accurate slow-stage time and routes an explicit processing cancel", () => {
    const trayManager = new TrayManager();
    const sendCancelProcessing = vi.fn();
    trayManager.setWindowManager({
      sendCancelProcessing,
      windowsPushToTalkAvailable: true,
    });
    trayManager.updateDictationStatus({
      stage: "transcribing",
      stageLabel: "Still transcribing",
      message: "OpenAI is taking longer than usual",
      elapsedMs: 52_000,
      stageElapsedMs: 12_000,
      canCancel: true,
      isSlow: true,
    });

    expect(trayManager.getStatusLabel(false)).toBe(
      "Status: OpenAI is taking longer than usual 0:12 · Insert"
    );
    const cancelItem = trayManager
      .buildContextMenuTemplate()
      .find((item: any) => item.label === "Cancel Processing");
    expect(cancelItem?.visible).toBe(true);

    cancelItem?.click();
    expect(sendCancelProcessing).toHaveBeenCalledOnce();
  });

  it("identifies the destination and waiting work in active status text", () => {
    const trayManager = new TrayManager();
    trayManager.updateDictationStatus({
      stage: "cleaning",
      stageLabel: "Cleaning",
      stageElapsedMs: 7_000,
      outputMode: "clipboard",
      waitingJobCount: 2,
      isProcessing: true,
    });

    expect(trayManager.getStatusLabel(false)).toBe("Status: Cleaning 0:07 · Clipboard · 2 waiting");
  });

  it("keeps clipboard dictation available while earlier jobs process", () => {
    const trayManager = new TrayManager();
    const sendStartDictation = vi.fn();
    const createSessionPayload = vi.fn(() => ({
      sessionId: "stacked-clipboard",
      outputMode: "clipboard",
    }));
    trayManager.setWindowManager({
      sendStartDictation,
      createSessionPayload,
      windowsPushToTalkAvailable: true,
    });
    trayManager.updateDictationStatus({
      stage: "transcribing",
      stageLabel: "Transcribing",
      queuedJobCount: 1,
      isProcessing: true,
      isRecording: false,
    });

    const menu = trayManager.buildContextMenuTemplate();
    const queueItem = menu.find((item: any) => String(item.label).startsWith("Queue:"));
    const startItem = menu.find((item: any) => item.label === "Start Clipboard Dictation");

    expect(queueItem).toMatchObject({ visible: true, enabled: false });
    expect(queueItem?.label).toContain("1 dictation processing or waiting");
    expect(startItem?.enabled).toBe(true);
    startItem?.click();
    expect(createSessionPayload).toHaveBeenCalledWith("clipboard");
    expect(sendStartDictation).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "stacked-clipboard", outputMode: "clipboard" })
    );
  });
});
