import { describe, expect, it, vi } from "vitest";

import { createAudioStats } from "./audioStats.js";
import {
  MAX_STREAMING_BUFFERED_BYTES,
  MAX_STREAMING_INBOUND_MESSAGE_BYTES,
  MAX_STREAMING_SESSION_AUDIO_BYTES,
} from "./constants.js";
import {
  cleanupSession,
  connectSession,
  disconnectSession,
  handleSessionMessage,
  sendAudioChunk,
} from "./sessionConnection.js";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  handlers = new Map<string, (...args: any[]) => void>();
  close = vi.fn();
  removeAllListeners = vi.fn();
  send = vi.fn();

  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
  }

  on(event: string, handler: (...args: any[]) => void) {
    this.handlers.set(event, handler);
  }
}

const createSelf = (overrides: Record<string, unknown> = {}) => ({
  ws: null,
  isConnected: false,
  sessionId: null,
  pendingResolve: null,
  pendingReject: null,
  terminationResolve: null,
  connectionTimeout: null,
  sessionStartedAt: Date.now(),
  limitErrorRaised: false,
  accumulatedText: "",
  lastTurnText: "",
  turns: [],
  audioStats: createAudioStats(),
  getAudioStats() {
    return { ...this.audioStats };
  },
  onError: vi.fn(),
  onFinalTranscript: vi.fn(),
  onPartialTranscript: vi.fn(),
  onSessionEnd: vi.fn(),
  resetAudioStats() {
    this.audioStats = createAudioStats();
  },
  hasWarmConnection: vi.fn(() => false),
  useWarmConnection: vi.fn(() => false),
  cleanup(error?: Error) {
    cleanupSession(this, error);
  },
  handleMessage(data: Buffer) {
    handleSessionMessage(this, data);
  },
  WebSocketConstructor: FakeWebSocket,
  ...overrides,
});

describe("AssemblyAI session lifecycle bounds", () => {
  it("returns explicit metadata when a warm socket is consumed", async () => {
    const self = createSelf({
      hasWarmConnection: vi.fn(() => true),
      useWarmConnection: vi.fn(() => true),
    });

    await expect(connectSession(self, { token: "test-token" })).resolves.toEqual({
      usedWarmConnection: true,
    });
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it.each([
    ["cold", false],
    ["warm-socket race", true],
  ])("returns cold metadata for a %s connection", async (_label, warmWasVisible) => {
    FakeWebSocket.instances = [];
    const self = createSelf({
      hasWarmConnection: vi.fn(() => warmWasVisible),
      useWarmConnection: vi.fn(() => false),
    });

    const connecting = connectSession(self, { token: "test-token" });
    expect(FakeWebSocket.instances).toHaveLength(1);
    handleSessionMessage(self, Buffer.from(JSON.stringify({ type: "Begin", id: "cold-session" })));

    await expect(connecting).resolves.toEqual({ usedWarmConnection: false });
  });

  it("rejects pending connection setup when cleanup interrupts CONNECTING", async () => {
    let rejectPending!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectPending = reject;
    });
    const self = createSelf({ pendingReject: rejectPending });

    cleanupSession(self, new Error("socket closed during setup"));

    await expect(pending).rejects.toThrow("socket closed during setup");
    expect(self.pendingReject).toBeNull();
  });

  it("fails closed when socket backpressure exceeds the bounded queue", () => {
    const socket = {
      readyState: 1,
      bufferedAmount: MAX_STREAMING_BUFFERED_BYTES + 1,
      send: vi.fn(),
      close: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    const self = createSelf({ ws: socket });

    expect(sendAudioChunk(self, Buffer.from([1, 2, 3, 4]))).toBe(false);
    expect(socket.send).not.toHaveBeenCalled();
    expect(self.onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "STREAMING_BACKPRESSURE" })
    );
    expect(self.ws).toBeNull();
  });

  it("caps cumulative session audio and inbound server messages", () => {
    const audioSelf = createSelf({
      audioStats: { ...createAudioStats(), bytesReceived: MAX_STREAMING_SESSION_AUDIO_BYTES },
      ws: {
        readyState: 1,
        bufferedAmount: 0,
        send: vi.fn(),
        close: vi.fn(),
        removeAllListeners: vi.fn(),
      },
    });
    expect(sendAudioChunk(audioSelf, Buffer.from([1]))).toBe(false);
    expect(audioSelf.onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "STREAMING_SESSION_LIMIT" })
    );

    const messageSelf = createSelf({
      ws: { close: vi.fn(), removeAllListeners: vi.fn() },
    });
    handleSessionMessage(messageSelf, Buffer.alloc(MAX_STREAMING_INBOUND_MESSAGE_BYTES + 1));
    expect(messageSelf.onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "STREAMING_RESPONSE_LIMIT" })
    );
    expect(messageSelf.ws).toBeNull();
  });

  it("never forwards provider-supplied error text to the renderer callback", () => {
    const socket = { close: vi.fn(), removeAllListeners: vi.fn() };
    const self = createSelf({ ws: socket });
    handleSessionMessage(
      self,
      Buffer.from(
        JSON.stringify({
          type: "Error",
          error: "SENSITIVE_PROVIDER_MARKER token=must-not-cross",
        })
      )
    );

    expect(self.onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "The streaming service reported an error",
        code: "STREAMING_PROVIDER_ERROR",
      })
    );
    expect(self.onError.mock.calls[0][0].message).not.toContain("SENSITIVE_PROVIDER_MARKER");
    expect(self.ws).toBeNull();
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("rejects cold startup immediately on a provider Error frame and settles only once", async () => {
    FakeWebSocket.instances = [];
    const self = createSelf();
    const connecting = connectSession(self, { token: "test-token" });

    handleSessionMessage(
      self,
      Buffer.from(JSON.stringify({ type: "Error", error: "private provider detail" }))
    );
    handleSessionMessage(self, Buffer.from(JSON.stringify({ type: "Error", error: "again" })));

    await expect(connecting).rejects.toMatchObject({ code: "STREAMING_PROVIDER_ERROR" });
    expect(self.onError).toHaveBeenCalledOnce();
    expect(self.ws).toBeNull();
  });

  it("still cleans up and rejects startup when the error callback throws", async () => {
    FakeWebSocket.instances = [];
    const self = createSelf({
      onError: vi.fn(() => {
        throw new Error("renderer callback failed");
      }),
    });
    const connecting = connectSession(self, { token: "test-token" });

    handleSessionMessage(
      self,
      Buffer.from(JSON.stringify({ type: "Error", error: "private provider detail" }))
    );

    await expect(connecting).rejects.toMatchObject({ code: "STREAMING_PROVIDER_ERROR" });
    expect(self.onError).toHaveBeenCalledOnce();
    expect(self.ws).toBeNull();
    expect(self.pendingReject).toBeNull();
  });

  it("resolves an in-flight termination as unconfirmed on a provider Error frame", async () => {
    const socket = {
      readyState: 1,
      close: vi.fn(),
      removeAllListeners: vi.fn(),
      send: vi.fn(),
    };
    const self = createSelf({ ws: socket, isConnected: true, accumulatedText: "Kept text" });
    const disconnecting = disconnectSession(self, true);
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "Terminate" }));

    handleSessionMessage(
      self,
      Buffer.from(JSON.stringify({ type: "Error", error: "termination failed" }))
    );

    await expect(disconnecting).resolves.toMatchObject({
      text: "Kept text",
      terminationConfirmed: false,
      terminationUnavailable: true,
    });
    expect(self.onError).toHaveBeenCalledOnce();
  });
});
