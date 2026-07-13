import { describe, expect, it, vi } from "vitest";

import { disconnectSession, handleSessionMessage } from "./sessionConnection.js";

const createSession = (ws: unknown = null) => ({
  ws,
  accumulatedText: "unconfirmed partial text",
  isDisconnecting: false,
  terminationResolve: null as null | ((result: unknown) => void),
  cleanup: vi.fn(),
  getAudioStats: vi.fn(() => ({ chunksSent: 1 })),
  onSessionEnd: vi.fn(),
});

describe("AssemblyAI session termination", () => {
  it("marks a missing socket as unconfirmed", async () => {
    const session = createSession();

    const result = await disconnectSession(session as any, true);

    expect(result).toMatchObject({
      text: "unconfirmed partial text",
      terminationConfirmed: false,
      terminationUnavailable: true,
    });
  });

  it("marks a non-open socket as unconfirmed", async () => {
    const session = createSession({ readyState: 3, close: vi.fn() });

    const result = await disconnectSession(session as any, true);

    expect(result).toMatchObject({
      text: "unconfirmed partial text",
      terminationConfirmed: false,
      terminationUnavailable: true,
    });
    expect(session.cleanup).toHaveBeenCalledTimes(1);
  });

  it("sets confirmation only from the server Termination event", async () => {
    const session = createSession({
      readyState: 1,
      close: vi.fn(),
      send: vi.fn(() => {
        queueMicrotask(() => {
          handleSessionMessage(
            session as any,
            Buffer.from(JSON.stringify({ type: "Termination", audio_duration_seconds: 4.2 }))
          );
        });
      }),
    });

    const result = await disconnectSession(session as any, true);

    expect(result).toMatchObject({
      text: "unconfirmed partial text",
      audioDuration: 4.2,
      terminationConfirmed: true,
    });
  });
});
