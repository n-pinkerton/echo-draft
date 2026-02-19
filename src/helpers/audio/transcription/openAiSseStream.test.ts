import { describe, expect, it, vi } from "vitest";

import { readOpenAiTranscriptionStream } from "./openAiSseStream.js";

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

describe("readOpenAiTranscriptionStream", () => {
  it("accumulates deltas and returns collected text on [DONE]", async () => {
    const emitProgress = vi.fn();
    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };

    const chunks = [
      'data: {"type":"transcript.text.delta","delta":"Hello"}\n\n',
      'data: {"type":"transcript.text.delta","delta":" world"}\n\n',
      "data: [DONE]\n\n",
    ];

    const response = makeResponseFromChunks(chunks);
    const text = await readOpenAiTranscriptionStream(response as any, {
      logger,
      emitProgress,
      trace: true,
    });

    expect(text).toBe("Hello world");
    expect(emitProgress).toHaveBeenCalledTimes(2);
    expect(emitProgress.mock.calls[0][0]).toEqual({ generatedChars: 5, generatedWords: 1 });
    expect(emitProgress.mock.calls[1][0]).toEqual({ generatedChars: 11, generatedWords: 2 });
  });

  it("handles JSON split across chunks", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };

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
    const text = await readOpenAiTranscriptionStream(response as any, { logger });
    expect(text).toBe("Hello world");
  });

  it("prefers collected deltas when done text is shorter", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };

    const chunks = [
      'data: {"type":"transcript.text.delta","delta":"Hello world"}\n\n',
      'data: {"type":"transcript.text.done","text":"Hello"}\n\n',
      "data: [DONE]\n\n",
    ];

    const response = makeResponseFromChunks(chunks);
    const text = await readOpenAiTranscriptionStream(response as any, { logger });
    expect(text).toBe("Hello world");
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("uses done text when it is at least as long as deltas", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), trace: vi.fn(), error: vi.fn() };

    const chunks = [
      'data: {"type":"transcript.text.delta","delta":"Hello "}\n\n',
      'data: {"type":"transcript.text.done","text":"Hello world"}\n\n',
      "data: [DONE]\n\n",
    ];

    const response = makeResponseFromChunks(chunks);
    const text = await readOpenAiTranscriptionStream(response as any, { logger });
    expect(text).toBe("Hello world");
  });
});

