import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/neonAuth", () => ({
  withSessionRefresh: async (fn: any) => await fn(),
}));

vi.mock("../../services/ReasoningService", () => ({
  default: {
    processText: vi.fn(async (text: string) => text),
    isAvailable: vi.fn(async () => true),
  },
}));

import AudioManager from "../audioManager.js";

const encoder = new TextEncoder();

const makeResponseFromChunks = (chunks: string[]) => {
  let index = 0;
  return {
    body: {
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) {
            return { value: undefined, done: true };
          }
          const value = encoder.encode(chunks[index++]);
          return { value, done: false };
        },
      }),
    },
  };
};

describe("AudioManager.readTranscriptionStream", () => {
  beforeEach(() => {
    localStorage.clear();
    (window as any).electronAPI = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("handles JSON split across chunks", async () => {
    const manager = new AudioManager();

    const sse =
      'data: {"type":"transcript.text.delta","delta":"Hello"}\n\n' +
      'data: {"type":"transcript.text.delta","delta":" world"}\n\n' +
      "data: [DONE]\n\n";

    const chunks = [
      'data: {"type":"transcript.text.delta","delta":"He',
      'llo"}\n\n',
      'data: {"type":"transcript.text.delta","delta":" wor',
      'ld"}\n\n',
      "data: [DONE]\n\n",
    ];

    expect(chunks.join("")).toBe(sse);

    const response = makeResponseFromChunks(chunks);
    const text = await manager.readTranscriptionStream(response as any);
    expect(text).toBe("Hello world");

    manager.cleanup();
  });

  it("prefers collected deltas when done text is shorter", async () => {
    const manager = new AudioManager();

    const chunks = [
      'data: {"type":"transcript.text.delta","delta":"Hello world"}\n\n',
      'data: {"type":"transcript.text.done","text":"Hello"}\n\n',
      "data: [DONE]\n\n",
    ];

    const response = makeResponseFromChunks(chunks);
    const text = await manager.readTranscriptionStream(response as any);
    expect(text).toBe("Hello world");

    manager.cleanup();
  });
});

