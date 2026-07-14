import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

import WindowsKeyManagerModule from "./windowsKeyManager.js";

const WindowsKeyManager = WindowsKeyManagerModule as any;

class FakeStream extends EventEmitter {
  setEncoding = vi.fn();
}

class FakeChild extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  kill = vi.fn(() => true);

  constructor(public pid: number) {
    super();
  }
}

describe("WindowsKeyManager listener replacement", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("refuses to overlap a replacement with a helper whose exit is unconfirmed", () => {
    const first = new FakeChild(101);
    spawnMock.mockReturnValueOnce(first);

    const manager = new WindowsKeyManager({ spawnFn: spawnMock });
    manager.isSupported = true;
    manager.resolveListenerBinary = () => "C:\\reviewed\\windows-key-listener.exe";
    const ready = vi.fn();
    const keyDown = vi.fn();
    const keyUp = vi.fn();
    manager.on("ready", ready);
    manager.on("key-down", keyDown);
    manager.on("key-up", keyUp);

    manager.start("F8", "insert");
    expect(manager.start("F9", "insert")).toBe(false);

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(manager.listenerProcesses.has("insert")).toBe(false);
    expect(manager.hasRetiringProcess("insert")).toBe(true);

    first.stdout.emit("data", "READY\nKEY_DOWN\nKEY_UP\n");
    first.emit("error", new Error("retired helper error"));
    first.emit("exit", 1, null);

    expect(ready).not.toHaveBeenCalled();
    expect(keyDown).not.toHaveBeenCalled();
    expect(keyUp).not.toHaveBeenCalled();
    expect(manager.hasRetiringProcess("insert")).toBe(false);
  });

  it("starts tap routes through the repeat-safe registered-hotkey protocol", () => {
    const child = new FakeChild(201);
    spawnMock.mockReturnValueOnce(child);

    const manager = new WindowsKeyManager({ spawnFn: spawnMock });
    manager.isSupported = true;
    manager.resolveListenerBinary = () => "C:\\reviewed\\windows-key-listener.exe";
    const ready = vi.fn();
    manager.on("ready", ready);

    manager.start("F10", "insert", { mode: "tap" });

    expect(spawnMock).toHaveBeenCalledWith(
      "C:\\reviewed\\windows-key-listener.exe",
      ["F10", "--tap"],
      expect.objectContaining({ windowsHide: true })
    );
    child.stdout.emit("data", "READY\nKEY_DOWN\n");
    expect(ready).toHaveBeenCalledWith({ hotkeyId: "insert", key: "F10", mode: "tap" });
  });

  it("frames READY and key events split across stdout chunks", () => {
    const child = new FakeChild(202);
    spawnMock.mockReturnValueOnce(child);

    const manager = new WindowsKeyManager({ spawnFn: spawnMock });
    manager.isSupported = true;
    manager.resolveListenerBinary = () => "C:\\reviewed\\windows-key-listener.exe";
    const ready = vi.fn();
    const keyDown = vi.fn();
    const keyUp = vi.fn();
    manager.on("ready", ready);
    manager.on("key-down", keyDown);
    manager.on("key-up", keyUp);

    manager.start("F10", "insert", { mode: "tap" });
    child.stdout.emit("data", "REA");
    child.stdout.emit("data", "DY\nKEY_");
    child.stdout.emit("data", "DOWN\nKEY_UP\n");

    expect(ready).toHaveBeenCalledOnce();
    expect(keyDown).toHaveBeenCalledWith("F10", "insert");
    expect(keyUp).toHaveBeenCalledWith("F10", "insert");
  });

  it("retires a helper that misses its readiness deadline and ignores late output", async () => {
    vi.useFakeTimers();
    const child = new FakeChild(203);
    spawnMock.mockReturnValueOnce(child);

    const manager = new WindowsKeyManager({ spawnFn: spawnMock, readyTimeoutMs: 50 });
    manager.isSupported = true;
    manager.resolveListenerBinary = () => "C:\\reviewed\\windows-key-listener.exe";
    const ready = vi.fn();
    const keyDown = vi.fn();
    const stopped = vi.fn();
    const error = vi.fn();
    manager.on("ready", ready);
    manager.on("key-down", keyDown);
    manager.on("route-stopped", stopped);
    manager.on("error", error);

    manager.start("F10", "insert", { mode: "tap" });
    await vi.advanceTimersByTimeAsync(51);
    child.stdout.emit("data", "READY\nKEY_DOWN\n");

    expect(child.kill).toHaveBeenCalled();
    expect(stopped).toHaveBeenCalledWith(
      expect.objectContaining({ hotkeyId: "insert", reason: "ready_timeout" })
    );
    expect(error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ hotkeyId: "insert", reason: "ready_timeout" })
    );
    expect(ready).not.toHaveBeenCalled();
    expect(keyDown).not.toHaveBeenCalled();
    expect(manager.hasRetiringProcess("insert")).toBe(true);
    vi.useRealTimers();
  });

  it("waits for the retired helper to exit before a replacement can claim its hotkey", async () => {
    const child = new FakeChild(301);
    child.kill.mockImplementation(() => {
      queueMicrotask(() => child.emit("exit", 0, null));
      return true;
    });
    spawnMock.mockReturnValueOnce(child);

    const manager = new WindowsKeyManager({ spawnFn: spawnMock });
    manager.isSupported = true;
    manager.resolveListenerBinary = () => "C:\\reviewed\\windows-key-listener.exe";
    manager.start("F10", "insert", { mode: "tap" });

    await expect(manager.stopAndWait("insert", 100)).resolves.toBe(true);
    expect(child.kill).toHaveBeenCalledOnce();
    expect(manager.listenerProcesses.has("insert")).toBe(false);
    expect(manager.hasRetiringProcess("insert")).toBe(false);
  });

  it("keeps a timed-out helper quarantined until a later exit is confirmed", async () => {
    const child = new FakeChild(302);
    spawnMock.mockReturnValueOnce(child);

    const manager = new WindowsKeyManager({ spawnFn: spawnMock });
    manager.isSupported = true;
    manager.resolveListenerBinary = () => "C:\\reviewed\\windows-key-listener.exe";
    const retired = vi.fn();
    manager.on("retirement-confirmed", retired);
    manager.start("F10", "insert", { mode: "tap" });

    await expect(manager.stopAndWait("insert", 5)).resolves.toBe(false);
    expect(manager.hasRetiringProcess("insert")).toBe(true);
    expect(manager.start("F11", "insert", { mode: "tap" })).toBe(false);
    expect(spawnMock).toHaveBeenCalledOnce();

    child.emit("exit", 0, null);
    expect(manager.hasRetiringProcess("insert")).toBe(false);
    expect(retired).toHaveBeenCalledWith(
      expect.objectContaining({ hotkeyId: "insert", key: "F10" })
    );
  });
});
