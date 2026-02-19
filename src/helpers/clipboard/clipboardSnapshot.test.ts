import { describe, expect, it, vi } from "vitest";

const { restoreClipboardSnapshot } = require("./clipboardSnapshot");

describe("clipboardSnapshot", () => {
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

    expect(clipboard.clear).toHaveBeenCalledTimes(1);
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
});
