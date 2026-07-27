import { describe, expect, it } from "vitest";

import {
  captureRawTranscription,
  createTranscriptionPersistencePayload,
} from "./rawTranscription";

describe("raw transcription contract", () => {
  it("freezes the transcription-stage snapshot independently of cleaned text", () => {
    const rawText = "please keep this request for the next agent";
    const snapshot = captureRawTranscription(rawText);
    let cleanedText = rawText;

    cleanedText = "Please keep this request for the next agent.";

    expect(snapshot).toEqual({ text: rawText });
    expect(snapshot.text).toBe(rawText);
    expect(snapshot.text).not.toBe(cleanedText);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("requires raw text and never substitutes the cleaned value", () => {
    expect(() =>
      createTranscriptionPersistencePayload({
        text: "Cleaned request.",
        rawText: undefined,
      })
    ).toThrow("Raw transcription is required");

    expect(
      createTranscriptionPersistencePayload({
        text: "Cleaned request.",
        rawText: "raw request",
        meta: { status: "success" },
      })
    ).toEqual({
      text: "Cleaned request.",
      rawText: "raw request",
      meta: { status: "success" },
    });
  });
});
