import { describe, expect, it } from "vitest";

const { isBlankAudioMarker, normalizeWhitespace, parseWhisperResult } = require("./resultParser");

describe("whisper resultParser", () => {
  it("normalizes whitespace", () => {
    expect(normalizeWhitespace("a\n b   c")).toBe("a b c");
  });

  it("detects blank audio markers", () => {
    expect(isBlankAudioMarker("[BLANK_AUDIO]")).toBe(true);
    expect(isBlankAudioMarker("hello")).toBe(false);
  });

  it("parses whisper-server object result", () => {
    expect(parseWhisperResult({ text: "hello\nworld" })).toEqual({
      success: true,
      text: "hello world",
    });
    expect(parseWhisperResult({ text: "[BLANK_AUDIO]" })).toEqual({
      success: false,
      message: "No audio detected",
    });
  });

  it("parses whisper.cpp JSON string result", () => {
    const payload = JSON.stringify({ transcription: [{ text: "hello" }, { text: "\nworld" }] });
    expect(parseWhisperResult(payload)).toEqual({ success: true, text: "hello world" });
  });

  it("falls back to plain text for non-JSON output", () => {
    expect(parseWhisperResult("hello\nworld")).toEqual({ success: true, text: "hello world" });
  });
});
