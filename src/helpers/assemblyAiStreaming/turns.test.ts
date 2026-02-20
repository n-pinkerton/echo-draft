import { describe, expect, it } from "vitest";

const { applyEndOfTurnTranscript, normalizeTurnText } = require("./turns");

describe("assemblyAiStreaming turns", () => {
  it("normalizes punctuation and whitespace", () => {
    expect(normalizeTurnText(" Hello,   world! ")).toBe("hello world");
  });

  it("adds, dedupes, and replaces formatted turns", () => {
    const turns: Array<{ text: string; normalized: string }> = [];

    const first = applyEndOfTurnTranscript(turns, "Hello.", false);
    expect(first.action).toBe("added");
    expect(first.accumulatedText).toBe("Hello.");

    const duplicateRaw = applyEndOfTurnTranscript(turns, "hello", false);
    expect(duplicateRaw.action).toBe("ignored-duplicate");
    expect(duplicateRaw.accumulatedText).toBe("Hello.");

    const formattedReplacement = applyEndOfTurnTranscript(turns, "Hello", true);
    expect(formattedReplacement.action).toBe("replaced-previous");
    expect(formattedReplacement.accumulatedText).toBe("Hello");
    expect(turns).toHaveLength(1);
  });

  it("ignores empty transcripts", () => {
    const turns: Array<{ text: string; normalized: string }> = [];
    const res = applyEndOfTurnTranscript(turns, "   ", false);
    expect(res.action).toBe("ignored-empty");
    expect(res.accumulatedText).toBe("");
  });
});

