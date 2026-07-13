import { describe, expect, it, vi } from "vitest";

import { warmupConnection } from "./warmConnection.js";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  handlers = new Map<string, (...args: any[]) => void>();
  close = vi.fn();
  ping = vi.fn();

  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
  }

  on(event: string, handler: (...args: any[]) => void) {
    this.handlers.set(event, handler);
  }

  emit(event: string, ...args: any[]) {
    this.handlers.get(event)?.(...args);
  }
}

const createSelf = () => ({
  warmConnection: null,
  warmConnectionReady: false,
  warmConnectionOptions: null,
  warmSessionId: null,
  keepAliveInterval: null,
  rewarmAttempts: 0,
  rewarmTimer: null,
  isConnected: false,
  WebSocketConstructor: FakeWebSocket,
  cacheToken: vi.fn(),
});

describe("AssemblyAI warm connection lifecycle", () => {
  it("rejects immediately and sanitizes a provider Error frame", async () => {
    FakeWebSocket.instances = [];
    const self = createSelf();
    const warming = warmupConnection(self, { token: "test-token" });
    const socket = FakeWebSocket.instances[0];

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ type: "Error", error: "SENSITIVE_PROVIDER_MARKER token=secret" })
      )
    );
    socket.emit("close", 1000, Buffer.alloc(0));

    await expect(warming).rejects.toMatchObject({
      message: "The streaming service reported an error",
      code: "STREAMING_PROVIDER_ERROR",
    });
    expect(self.warmConnection).toBeNull();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
