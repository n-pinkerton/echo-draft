import { afterEach, describe, expect, it, vi } from "vitest";

const {
  isClipboardSnapshotRestorable,
  restoreClipboardSnapshot,
  scheduleClipboardRestore,
  snapshotClipboard,
} = require("./clipboardSnapshot");

describe("clipboardSnapshot", () => {
  afterEach(() => vi.useRealTimers());

  it("restores primary clipboard data (text/html/rtf) when present", () => {
    const clipboard = {
      clear: vi.fn(),
      write: vi.fn(),
      writeBuffer: vi.fn(),
      writeText: vi.fn(),
    };

    const manager = {
      deps: {
        clipboard,
        nativeImage: { createFromBuffer: vi.fn() },
        platform: "win32",
      },
      safeLog: vi.fn(),
      _isWayland: () => false,
      _writeClipboardWayland: vi.fn(),
    };

    restoreClipboardSnapshot(
      manager,
      {
        text: "hello",
        html: "<b>hello</b>",
        rtf: "{\\rtf1 hello}",
        imagePng: null,
        formats: [],
      },
      null
    );

    expect(clipboard.clear).not.toHaveBeenCalled();
    expect(clipboard.write).toHaveBeenCalledWith({
      text: "hello",
      html: "<b>hello</b>",
      rtf: "{\\rtf1 hello}",
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("falls back to writeText when clipboard.write fails", () => {
    const clipboard = {
      clear: vi.fn(),
      write: vi.fn(() => {
        throw new Error("write failed");
      }),
      writeBuffer: vi.fn(),
      writeText: vi.fn(),
    };

    const manager = {
      deps: {
        clipboard,
        nativeImage: { createFromBuffer: vi.fn() },
        platform: "linux",
      },
      safeLog: vi.fn(),
      _isWayland: () => false,
      _writeClipboardWayland: vi.fn(),
    };

    restoreClipboardSnapshot(
      manager,
      {
        text: "fallback",
        html: "",
        rtf: "",
        imagePng: null,
        formats: [],
      },
      null
    );

    expect(clipboard.writeText).toHaveBeenCalledWith("fallback");
    expect(manager._writeClipboardWayland).not.toHaveBeenCalled();
  });

  it("refuses to restore primary data when custom formats would be dropped", () => {
    const imagePng = Buffer.from("image-png");
    const clipboard = {
      clear: vi.fn(),
      write: vi.fn(),
      writeBuffer: vi.fn(),
      writeImage: vi.fn(),
      writeText: vi.fn(),
    };
    const createFromBuffer = vi.fn();
    const manager = {
      deps: {
        clipboard,
        nativeImage: { createFromBuffer },
        platform: "win32",
      },
      safeLog: vi.fn(),
      _isWayland: () => false,
      _writeClipboardWayland: vi.fn(),
    };

    const result = restoreClipboardSnapshot(manager, {
      text: "clipboard text",
      html: "<b>clipboard text</b>",
      rtf: "",
      imagePng,
      restorable: false,
      formats: [
        { format: "application/x-echodraft-canary" },
        { format: "application/x-second-format" },
      ],
    });

    expect(result).toEqual({ success: false, reason: "custom_formats" });
    expect(createFromBuffer).not.toHaveBeenCalled();
    expect(clipboard.clear).not.toHaveBeenCalled();
    expect(clipboard.write).not.toHaveBeenCalled();
    expect(clipboard.writeBuffer).not.toHaveBeenCalled();
    expect(clipboard.writeImage).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("marks every non-primary format unsafe without reading experimental buffers", () => {
    const clipboard = {
      readText: vi.fn(() => "keep this text"),
      readHTML: vi.fn(() => ""),
      readRTF: vi.fn(() => ""),
      readImage: vi.fn(() => ({ isEmpty: () => true })),
      availableFormats: vi.fn(() => [
        "text/plain",
        "text/html",
        "application/x-empty",
        "application/x-canary",
      ]),
      readBuffer: vi.fn(),
    };
    const manager = { deps: { clipboard, platform: "win32" } };

    const snapshot = snapshotClipboard(manager);

    expect(snapshot.text).toBe("keep this text");
    expect(snapshot.formats).toEqual([
      { format: "application/x-empty" },
      { format: "application/x-canary" },
    ]);
    expect(snapshot.restorable).toBe(false);
    expect(isClipboardSnapshotRestorable(snapshot)).toBe(false);
    expect(clipboard.readBuffer).not.toHaveBeenCalled();
  });

  it("does not overwrite a custom-only clipboard", () => {
    const clipboard = {
      clear: vi.fn(),
      write: vi.fn(),
      writeBuffer: vi.fn(),
      writeText: vi.fn(),
    };
    const manager = {
      deps: {
        clipboard,
        nativeImage: { createFromBuffer: vi.fn() },
        platform: "win32",
      },
      safeLog: vi.fn(),
      _isWayland: () => false,
      _writeClipboardWayland: vi.fn(),
    };

    const result = restoreClipboardSnapshot(manager, {
      text: "",
      html: "",
      rtf: "",
      imagePng: null,
      restorable: false,
      formats: [{ format: "application/x-empty" }, { format: "application/x-canary" }],
    });

    expect(result).toEqual({ success: false, reason: "custom_formats" });
    expect(clipboard.writeBuffer).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("skips delayed restoration when the user copied newer text", async () => {
    vi.useFakeTimers();
    let clipboardText = "dictation";
    const manager = {
      deps: {
        clipboard: {
          readText: vi.fn(() => clipboardText),
          writeText: vi.fn((text: string) => {
            clipboardText = text;
          }),
        },
        nativeImage: { createFromBuffer: vi.fn() },
        platform: "win32",
        setTimeout,
      },
      safeLog: vi.fn(),
      _isWayland: () => false,
      _writeClipboardWayland: vi.fn(),
    };

    const pending = scheduleClipboardRestore(
      manager,
      { text: "original", html: "", rtf: "", imagePng: null, formats: [] },
      50,
      null,
      { expectedText: "dictation" }
    );
    clipboardText = "newer user copy";
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toEqual({
      success: true,
      skipped: true,
      reason: "clipboard_changed",
    });
    expect(clipboardText).toBe("newer user copy");
  });
});
