import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const { pasteMacOS } = require("./macosPaste");

describe("macosPaste", () => {
  it("spawns osascript and schedules restore on success", async () => {
    vi.useFakeTimers();

    const proc = new EventEmitter() as any;
    proc.stderr = new EventEmitter();

    const spawn = vi.fn((..._args: any[]) => {
      queueMicrotask(() => proc.emit("close", 0));
      return proc;
    });

    const manager = {
      deps: { spawn, killProcess: vi.fn() },
      resolveFastPasteBinary: () => null,
      scheduleClipboardRestore: vi.fn(),
      safeLog: vi.fn(),
      accessibilityCache: { value: true, expiresAt: 1 },
      fastPasteChecked: false,
      fastPastePath: null,
    };

    const promise = pasteMacOS(manager, { text: "x", formats: [] }, { fromStreaming: false });
    await vi.runAllTimersAsync();
    await promise;

    expect(spawn).toHaveBeenCalled();
    const [cmd] = spawn.mock.calls[0];
    expect(cmd).toBe("osascript");
    expect(manager.scheduleClipboardRestore).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
