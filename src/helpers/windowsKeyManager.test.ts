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

  it("ignores all buffered protocol output from a retired helper process", () => {
    const first = new FakeChild(101);
    const second = new FakeChild(102);
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

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
    manager.start("F9", "insert");

    first.stdout.emit("data", "READY\nKEY_DOWN\nKEY_UP\n");
    first.emit("error", new Error("retired helper error"));
    first.emit("exit", 1, null);

    expect(ready).not.toHaveBeenCalled();
    expect(keyDown).not.toHaveBeenCalled();
    expect(keyUp).not.toHaveBeenCalled();
    expect(manager.listenerProcesses.get("insert")?.process).toBe(second);

    second.stdout.emit("data", "READY\nKEY_DOWN\nKEY_UP\n");
    expect(ready).toHaveBeenCalledWith({ hotkeyId: "insert", key: "F9" });
    expect(keyDown).toHaveBeenCalledWith("F9", "insert");
    expect(keyUp).toHaveBeenCalledWith("F9", "insert");
  });
});
