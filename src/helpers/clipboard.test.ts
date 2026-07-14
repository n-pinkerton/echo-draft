import { afterEach, describe, expect, it, vi } from "vitest";

const ClipboardManager = require("./clipboard");

describe("ClipboardManager", () => {
  afterEach(() => vi.useRealTimers());

  const createManager = (overrides: Record<string, unknown> = {}) =>
    new ClipboardManager({
      platform: "win32",
      env: {},
      clipboard: { readText: vi.fn(), writeText: vi.fn() },
      nativeImage: { createFromBuffer: vi.fn() },
      spawn: vi.fn(),
      spawnSync: vi.fn(() => ({ status: 1 })),
      killProcess: vi.fn(),
      fs: { existsSync: vi.fn() },
      path: require("path"),
      debugLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      resourcesPath: "/res",
      cwd: "/cwd",
      helpersDir: "/helpers",
      now: () => 100,
      ...overrides,
    });

  it("reads Windows nircmd preference flags from env", () => {
    const manager = new ClipboardManager({
      platform: "win32",
      env: { OPENWHISPR_WINDOWS_USE_NIRCMD: "true" },
      clipboard: { readText: vi.fn(), writeText: vi.fn() },
      nativeImage: { createFromBuffer: vi.fn() },
      spawn: vi.fn(),
      spawnSync: vi.fn(() => ({ status: 1 })),
      killProcess: vi.fn(),
      fs: { existsSync: vi.fn() },
      path: require("path"),
      debugLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      resourcesPath: "/res",
      cwd: "/cwd",
      helpersDir: "/helpers",
      now: () => 0,
    });

    expect(manager.shouldPreferNircmd()).toBe(true);
  });

  it("caches commandExists checks within TTL", () => {
    const spawnSync = vi.fn(() => ({ status: 0 }));

    const manager = new ClipboardManager({
      platform: "linux",
      env: {},
      clipboard: { readText: vi.fn(), writeText: vi.fn() },
      nativeImage: { createFromBuffer: vi.fn() },
      spawn: vi.fn(),
      spawnSync,
      killProcess: vi.fn(),
      fs: { existsSync: vi.fn() },
      path: require("path"),
      debugLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      resourcesPath: "/res",
      cwd: "/cwd",
      helpersDir: "/helpers",
      now: () => 0,
    });

    expect(manager.commandExists("echo")).toBe(true);
    expect(manager.commandExists("echo")).toBe(true);
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it("issues opaque insertion capabilities and consumes them exactly once", () => {
    const manager = createManager();
    const target = { hwnd: 42, pid: 9, processName: "SecretApp", title: "Private title" };
    const snapshot = manager.issueInsertionTargetCapability(target, {
      ownerId: 7,
      sessionId: "session-1",
    });

    expect(snapshot).toEqual({
      capability: expect.any(String),
      sessionId: "session-1",
      capturedAt: 100,
    });
    expect(snapshot).not.toHaveProperty("hwnd");
    expect(snapshot).not.toHaveProperty("processName");
    expect(
      manager.consumeInsertionTargetCapability(snapshot, { ownerId: 7, sessionId: "session-1" })
    ).toBe(target);
    expect(
      manager.consumeInsertionTargetCapability(snapshot, { ownerId: 7, sessionId: "session-1" })
    ).toBeNull();
  });

  it("does not consume a capability for the wrong renderer or session", () => {
    const manager = createManager();
    const target = { hwnd: 42 };
    const snapshot = manager.issueInsertionTargetCapability(target, {
      ownerId: 7,
      sessionId: "session-1",
    });

    expect(
      manager.consumeInsertionTargetCapability(snapshot, { ownerId: 8, sessionId: "session-1" })
    ).toBeNull();
    expect(
      manager.consumeInsertionTargetCapability(snapshot, { ownerId: 7, sessionId: "session-2" })
    ).toBeNull();
    expect(
      manager.consumeInsertionTargetCapability(snapshot, { ownerId: 7, sessionId: "session-1" })
    ).toBe(target);
  });

  it("does not expose insertion target metadata when activation fails", async () => {
    const manager = createManager();
    manager.snapshotClipboard = vi.fn(() => ({ formats: [], text: "" }));
    manager.pasteWindows = vi.fn(async () => {
      throw new Error(
        "The original app lost focus or could not be authenticated. Text is copied to the clipboard; paste it manually with Ctrl+V."
      );
    });

    const error = await manager
      .pasteText("dictated text", {
        insertionTarget: {
          hwnd: 42,
          pid: 9,
          processName: "SecretApp",
          title: "Private patient record",
        },
      })
      .catch((caught: Error) => caught);

    expect(error.message).toMatch(/original app/i);
    expect(error.message).not.toMatch(/SecretApp|Private patient record|42|9/);
    expect((error as any).clipboardWriteCommitted).toBe(true);
  });

  it("serializes stacked Windows insertions through clipboard restoration", async () => {
    vi.useFakeTimers();
    let clipboardText = "original clipboard";
    const inserted: string[] = [];
    const clipboard = {
      readText: vi.fn(() => clipboardText),
      readHTML: vi.fn(() => ""),
      readRTF: vi.fn(() => ""),
      readImage: vi.fn(() => ({ isEmpty: () => true })),
      availableFormats: vi.fn(() => ["text/plain"]),
      write: vi.fn((data: { text?: string }) => {
        clipboardText = data.text || "";
      }),
      writeText: vi.fn((text: string) => {
        clipboardText = text;
      }),
    };
    const manager = createManager({ clipboard });
    manager.pasteWindows = vi.fn(async (snapshot, options) => {
      inserted.push(clipboardText);
      await manager.scheduleClipboardRestore(snapshot, 50, null, {
        expectedText: options.expectedClipboardText,
      });
    });

    const first = manager.pasteText("first dictation");
    const second = manager.pasteText("second dictation");
    await vi.advanceTimersByTimeAsync(0);
    expect(inserted).toEqual(["first dictation"]);

    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(0);
    expect(inserted).toEqual(["first dictation", "second dictation"]);
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([first, second]);

    expect(clipboardText).toBe("original clipboard");
    expect(manager.pasteWindows).toHaveBeenCalledTimes(2);
  });

  it("keeps newer user clipboard text copied during a delayed restore", async () => {
    vi.useFakeTimers();
    let clipboardText = "original clipboard";
    const clipboard = {
      readText: vi.fn(() => clipboardText),
      readHTML: vi.fn(() => ""),
      readRTF: vi.fn(() => ""),
      readImage: vi.fn(() => ({ isEmpty: () => true })),
      availableFormats: vi.fn(() => ["text/plain"]),
      write: vi.fn((data: { text?: string }) => {
        clipboardText = data.text || "";
      }),
      writeText: vi.fn((text: string) => {
        clipboardText = text;
      }),
    };
    const manager = createManager({ clipboard });
    manager.pasteWindows = vi.fn(async (snapshot, options) => {
      await manager.scheduleClipboardRestore(snapshot, 50, null, {
        expectedText: options.expectedClipboardText,
      });
    });

    const pending = manager.pasteText("dictation");
    await vi.advanceTimersByTimeAsync(0);
    clipboardText = "newer user copy";
    await vi.advanceTimersByTimeAsync(50);
    await pending;

    expect(clipboardText).toBe("newer user copy");
  });

  it("refuses a custom-format Windows clipboard before writing", async () => {
    const manager = createManager();
    manager.snapshotClipboard = vi.fn(() => ({
      text: "keep",
      html: "",
      rtf: "",
      imagePng: null,
      formats: [{ format: "application/x-private" }],
      restorable: false,
    }));
    manager.pasteWindows = vi.fn();

    await expect(manager.pasteText("dictation")).rejects.toMatchObject({
      code: "WINDOWS_CLIPBOARD_PRESERVATION_UNSUPPORTED",
    });
    expect(manager.deps.clipboard.writeText).not.toHaveBeenCalled();
    expect(manager.pasteWindows).not.toHaveBeenCalled();
  });

  it("blocks a later insertion while a previous clipboard snapshot cannot be recovered", async () => {
    const manager = createManager();
    manager.pendingWindowsClipboardRestoration = {
      snapshot: { text: "previous clipboard", formats: [] },
      expectedText: "first dictation",
    };
    manager.scheduleClipboardRestore = vi.fn(async () => ({ success: false, reason: "locked" }));
    manager.snapshotClipboard = vi.fn();

    await expect(manager.pasteText("second dictation")).rejects.toMatchObject({
      code: "WINDOWS_CLIPBOARD_RESTORE_PENDING",
    });
    expect(manager.snapshotClipboard).not.toHaveBeenCalled();
    expect(manager.deps.clipboard.writeText).not.toHaveBeenCalled();
  });
});
