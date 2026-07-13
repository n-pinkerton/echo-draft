// @vitest-environment node
import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";

const { CdpClient } = require("./cdpClient");

class SilentWebSocket extends EventEmitter {
  send(_payload: string, callback: (error?: Error) => void) {
    callback();
  }
}

describe("Windows release gate CDP client", () => {
  it("times out an unanswered command instead of hanging the gate", async () => {
    const client = new CdpClient("ws://example.invalid", { commandTimeoutMs: 20 });
    client.ws = new SilentWebSocket();

    await expect(client.send("Page.captureScreenshot")).rejects.toThrow(
      "CDP command Page.captureScreenshot timed out after 20ms"
    );
    expect(client.pending.size).toBe(0);
  });

  it("rejects pending commands when the client closes", async () => {
    const client = new CdpClient("ws://example.invalid", { commandTimeoutMs: 5000 });
    const socket = new SilentWebSocket();
    socket.close = vi.fn();
    socket.terminate = vi.fn();
    client.ws = socket;

    const pending = client.send("Runtime.evaluate");
    const closing = client.close();

    await expect(pending).rejects.toThrow("CDP client closed before the command completed");
    socket.emit("close");
    await closing;
    expect(client.pending.size).toBe(0);
  });
});
