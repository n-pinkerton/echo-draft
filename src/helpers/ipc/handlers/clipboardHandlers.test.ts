import { describe, expect, it, vi } from "vitest";

import { registerClipboardHandlers } from "./clipboardHandlers.js";

const createHarness = () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
  };
  const sender: any = { id: 17, getURL: () => "file:///app/index.html?view=dictation" };
  sender.mainFrame = { url: sender.getURL() };
  const dictationWindow = {
    __echoDraftTrustedUrl: sender.getURL(),
    webContents: sender,
    isDestroyed: () => false,
  };
  const controlSender: any = {
    id: 18,
    getURL: () => "file:///app/index.html?view=control-panel",
  };
  controlSender.mainFrame = { url: controlSender.getURL() };
  const controlPanelWindow = {
    __echoDraftTrustedUrl: controlSender.getURL(),
    webContents: controlSender,
    isDestroyed: () => false,
  };
  const target = { hwnd: 42, pid: 9, processName: "PrivateApp", title: "Private title" };
  const opaqueTarget = {
    capability: "opaque-capability",
    sessionId: "session-1",
    capturedAt: 100,
  };
  const clipboardManager = {
    captureInsertionTarget: vi.fn(async () => ({ success: true, target })),
    issueInsertionTargetCapability: vi.fn(() => opaqueTarget),
    consumeInsertionTargetCapability: vi.fn(() => target),
    pasteText: vi.fn(async () => undefined),
    readClipboard: vi.fn(async () => "dictated text"),
    writeClipboard: vi.fn(async () => ({ success: true })),
    checkPasteTools: vi.fn(() => ({ platform: "win32", available: true })),
    checkAccessibilityPermissions: vi.fn(async () => true),
  };
  const windowManager = {
    mainWindow: dictationWindow,
    controlPanelWindow,
    claimInsertionTargetSession: vi.fn(() => true),
    isIssuedDictationSession: vi.fn(() => true),
  };

  registerClipboardHandlers(
    { ipcMain, platform: "win32" } as any,
    { clipboardManager, windowManager } as any
  );

  return {
    handlers,
    sender,
    controlSender,
    clipboardManager,
    windowManager,
    opaqueTarget,
    target,
  };
};

describe("clipboardHandlers", () => {
  it("does not expose a general main-process clipboard read channel", () => {
    const { handlers } = createHarness();
    expect(handlers.has("read-clipboard")).toBe(false);
  });

  it("returns only an opaque, session-bound insertion target", async () => {
    const { handlers, sender, clipboardManager, opaqueTarget } = createHarness();
    const result = await handlers.get("capture-insertion-target")?.(
      { sender, senderFrame: sender.mainFrame },
      "session-1"
    );

    expect(result).toEqual({ success: true, target: opaqueTarget });
    expect(result.target).not.toHaveProperty("hwnd");
    expect(result.target).not.toHaveProperty("processName");
    expect(clipboardManager.issueInsertionTargetCapability).toHaveBeenCalledWith(
      expect.objectContaining({ hwnd: 42 }),
      { ownerId: 17, sessionId: "session-1" }
    );
  });

  it("resolves the capability in main and strips unapproved paste options", async () => {
    const { handlers, sender, clipboardManager, opaqueTarget, target } = createHarness();
    const result = await handlers.get("paste-text")?.(
      { sender, senderFrame: sender.mainFrame },
      "dictated text",
      {
        sessionId: "session-1",
        insertionTarget: opaqueTarget,
        fromStreaming: true,
        forged: "ignored",
      }
    );

    expect(result).toEqual({ success: true });
    expect(clipboardManager.consumeInsertionTargetCapability).toHaveBeenCalledWith(opaqueTarget, {
      ownerId: 17,
      sessionId: "session-1",
    });
    expect(clipboardManager.pasteText).toHaveBeenCalledWith("dictated text", {
      fromStreaming: true,
      insertionTarget: target,
      webContents: sender,
    });
  });

  it("returns a sanitized operational reason when authenticated insertion fails", async () => {
    const { handlers, sender, clipboardManager, opaqueTarget } = createHarness();
    clipboardManager.pasteText.mockRejectedValueOnce(
      Object.assign(new Error("private native detail"), {
        code: "WINDOWS_SECURE_PASTE_SEND_INPUT_FAILED",
        clipboardWriteCommitted: true,
      })
    );

    await expect(
      handlers.get("paste-text")?.({ sender, senderFrame: sender.mainFrame }, "dictated text", {
        sessionId: "session-1",
        insertionTarget: opaqueTarget,
      })
    ).resolves.toEqual({
      success: false,
      errorCode: "WINDOWS_SECURE_PASTE_SEND_INPUT_FAILED",
      clipboardWriteCommitted: true,
      clipboardRetained: true,
    });
  });

  it("reports when newer clipboard content replaced EchoDraft's failed-paste lease", async () => {
    const { handlers, sender, clipboardManager, opaqueTarget } = createHarness();
    clipboardManager.pasteText.mockRejectedValueOnce(
      Object.assign(new Error("private native detail"), {
        code: "WINDOWS_SECURE_PASTE_SEND_INPUT_FAILED",
        clipboardWriteCommitted: true,
      })
    );
    clipboardManager.readClipboard.mockResolvedValueOnce("newer user clipboard");

    await expect(
      handlers.get("paste-text")?.({ sender, senderFrame: sender.mainFrame }, "dictated text", {
        sessionId: "session-1",
        insertionTarget: opaqueTarget,
      })
    ).resolves.toEqual({
      success: false,
      errorCode: "WINDOWS_SECURE_PASTE_SEND_INPUT_FAILED",
      clipboardWriteCommitted: true,
      clipboardRetained: false,
    });
  });

  it("reports insertion success separately from a clipboard-restoration warning", async () => {
    const { handlers, sender, clipboardManager, opaqueTarget } = createHarness();
    clipboardManager.pasteText.mockResolvedValueOnce({
      success: true,
      injected: true,
      clipboardRestored: false,
      warningCode: "WINDOWS_CLIPBOARD_RESTORE_FAILED",
    });

    await expect(
      handlers.get("paste-text")?.({ sender, senderFrame: sender.mainFrame }, "dictated text", {
        sessionId: "session-1",
        insertionTarget: opaqueTarget,
      })
    ).resolves.toEqual({
      success: true,
      inserted: true,
      clipboardRestored: false,
      warningCode: "WINDOWS_CLIPBOARD_RESTORE_FAILED",
    });
  });

  it("rejects untrusted frames and oversized text but structures trusted preflight failures", async () => {
    const { handlers, sender, clipboardManager, windowManager, opaqueTarget } = createHarness();
    const foreignSender: any = { id: 99, getURL: () => "file:///foreign.html" };

    await expect(
      handlers.get("paste-text")?.(
        { sender: foreignSender, senderFrame: foreignSender.mainFrame },
        "text",
        {}
      )
    ).rejects.toMatchObject({ code: "UNTRUSTED_RENDERER" });

    await expect(
      handlers.get("paste-text")?.({ sender, senderFrame: sender.mainFrame }, "text", {
        fromStreaming: true,
      })
    ).resolves.toEqual({ success: false, errorCode: "MISSING_INSERTION_TARGET" });

    windowManager.isIssuedDictationSession.mockReturnValueOnce(false);
    await expect(
      handlers.get("paste-text")?.({ sender, senderFrame: sender.mainFrame }, "text", {
        sessionId: "session-1",
        insertionTarget: opaqueTarget,
      })
    ).resolves.toEqual({ success: false, errorCode: "INVALID_INSERTION_SESSION" });

    clipboardManager.consumeInsertionTargetCapability.mockReturnValueOnce(null);
    await expect(
      handlers.get("paste-text")?.({ sender, senderFrame: sender.mainFrame }, "text", {
        sessionId: "session-1",
        insertionTarget: opaqueTarget,
      })
    ).resolves.toEqual({ success: false, errorCode: "INVALID_INSERTION_TARGET" });

    await expect(
      handlers.get("write-clipboard")?.(
        { sender, senderFrame: sender.mainFrame },
        "x".repeat(1_000_001)
      )
    ).rejects.toMatchObject({ code: "INVALID_CLIPBOARD_TEXT" });
  });

  it("allows the control panel only the read-only accessibility check", async () => {
    const { handlers, controlSender, clipboardManager } = createHarness();
    await expect(
      handlers.get("check-accessibility-permission")?.({
        sender: controlSender,
        senderFrame: controlSender.mainFrame,
      })
    ).resolves.toBe(true);
    expect(clipboardManager.checkAccessibilityPermissions).toHaveBeenCalledOnce();

    await expect(
      handlers.get("write-clipboard")?.(
        { sender: controlSender, senderFrame: controlSender.mainFrame },
        "text"
      )
    ).rejects.toMatchObject({ code: "UNTRUSTED_RENDERER" });
  });
});
