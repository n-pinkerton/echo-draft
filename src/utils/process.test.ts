import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

const { terminateProcessTreeAndWait } = require("./process");

const createChild = (pid: number) => {
  const child = new EventEmitter() as any;
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn();
  return child;
};

describe("terminateProcessTreeAndWait", () => {
  it("does not settle until the target child confirms exit after taskkill", async () => {
    const target = createChild(1234);
    const taskkill = createChild(5678);
    const spawnImpl = vi.fn(() => taskkill);
    let settled = false;

    const resultPromise = terminateProcessTreeAndWait(target, "SIGKILL", {
      platform: "win32",
      spawnImpl,
      timeoutMs: 1_000,
    }).then((result: boolean) => {
      settled = true;
      return result;
    });

    taskkill.exitCode = 0;
    taskkill.emit("close", 0);
    await Promise.resolve();
    expect(settled).toBe(false);

    target.exitCode = 1;
    target.emit("exit", 1);
    await expect(resultPromise).resolves.toBe(true);
    expect(spawnImpl).toHaveBeenCalledWith(
      "taskkill",
      ["/pid", "1234", "/f", "/t"],
      expect.objectContaining({ windowsHide: true })
    );
  });

  it("returns false when taskkill fails and the target never confirms exit", async () => {
    const target = createChild(1234);
    const taskkill = createChild(5678);
    const resultPromise = terminateProcessTreeAndWait(target, "SIGKILL", {
      platform: "win32",
      spawnImpl: () => taskkill,
      timeoutMs: 15,
    });

    taskkill.emit("error", new Error("taskkill unavailable"));

    await expect(resultPromise).resolves.toBe(false);
  });
});
